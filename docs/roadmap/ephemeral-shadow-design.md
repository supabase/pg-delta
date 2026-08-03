# Design: ephemeral / auto-provisioned shadow for `schema apply`

Status: **design only — not implemented** (deferred). Captures the problem, the
correctness tension we discovered, and the alternatives with trade-offs so
implementation can pick a path later.

Scope note: the related **progress-based shadow-load round cap** (a separate,
self-contained fix) IS implemented — `loadSqlFiles` now scales `maxRounds` with
file count (`Math.max(files.length + 1, 25)`) so a deep dependency chain that is
making progress never hits an artificial ceiling. This doc is only about
auto-provisioning the shadow database itself.

## Problem

`schema apply` materializes the declarative `.sql` files into a **shadow**
database, extracts it, and diffs against the target (parser-free design —
"Postgres is the elaborator", see `packages/pg-delta/src/frontends/load-sql-files.ts`).
Today `--shadow <pg-url>` is **required**, so the operator must provision and
manage a second empty Postgres database. That is the single biggest DX friction
in the declarative flow. Goal: make `--shadow` optional by auto-provisioning a
throwaway shadow, while staying **safe** and **correct**.

## The correctness tension we found (the crux)

A naive auto-shadow on the **target's own cluster** (a sibling temp database) is
**unsafe**: cluster-global DDL (`CREATE ROLE`, role `GRANT`s, `ALTER DEFAULT
PRIVILEGES`, `TABLESPACE`) isn't database-scoped, and the loader commits
per-file, so such statements **commit against the real target cluster** before
any leak check — and `ALTER ROLE … SET` on a pre-existing role can't be undone.
→ Rejected.

An **isolated** shadow (its own cluster, e.g. a Docker container) is safe, but
introduces a **correctness** problem: it has its *own* cluster-global roles
(`postgres`, `pg_*`) that differ from the target's (`test`, app roles, `pg_*`).
Extraction includes role/membership/default-privilege facts, so diffing the
shadow against the target produces **spurious and dangerous** role changes
(drop the target's roles, recreate the shadow's, churn ownership) even when the
declarative files never mention roles.

Root cause: the existing same-cluster `--shadow` flow is correct for roles only
**by accident** — roles are cluster-global and therefore visible identically
from any database on the same cluster, so they cancel in the diff. The tool has
an implicit assumption that **shadow and target share a cluster**. Any isolated
auto-shadow breaks that assumption. (This latent issue also affects a
user-supplied `--shadow` on a *different* cluster; isolation just forces it into
the open.)

Conclusion: declarative **schema** (database-local) and cluster-global
**roles/grants** are two problems with different correctness models. An
auto-shadow naturally serves the former; the latter needs the target's cluster
context.

## Airtight, parser-free detection of cluster-global intent

An isolated container starts **pristine**, which gives a clean primitive: snapshot
its cluster-global catalog (`pg_roles`/`pg_auth_members`/`pg_db_role_setting`/…)
**before** loading the files and **after**. The delta is exactly what the files
declared for cluster-global state — DO-blocks, dynamic SQL, anything — because
it's the *real post-load catalog*, not a text scan. This is consistent with
"Postgres is the elaborator" and is safe (it's inside the throwaway container).
Used either to **refuse** (option B) or as the **baseline** input (option C).

## Alternatives

### A. Sibling temp DB on the target's cluster — REJECTED
Correct for roles (shared cluster) but unsafe: cluster-global DDL in the files
leaks/commits onto the target before detection. Not viable.

### B. Isolated Docker container + scope cluster-global OUT of the diff
- Container = dedicated cluster ⇒ fully safe. Image `postgres:<target-major>-alpine`
  ⇒ version-correct extraction.
- Filter `role` / `membership` / `defaultPrivilege` (and other cluster-global)
  facts out of both sides before diffing, so the bootstrap-role mismatch never
  surfaces. Owner edges to scoped-out roles prune ⇒ objects created
  applier-owned (no spurious `ALTER … OWNER`).
- Use the before/after snapshot to **refuse loudly** if the files manage
  cluster-global state ("auto-shadow manages database-local schema only — use
  `--shadow` on a cluster matching the target for roles").
- **Pro:** simplest correct option. **Con:** auto-shadow can't manage roles at
  all (not even add).

### C. Isolated Docker container + BASELINE subtraction — RECOMMENDED
Reuse `subtractBaseline` (`packages/pg-delta/src/policy/baseline.ts`), which
drops facts present-and-identical (same id + payload hash) in a baseline
`FactBase` from **both** sides before diffing (`resolveView`,
`packages/pg-delta/src/policy/policy.ts`).

Baseline = **(shadow container's pristine cluster-global state) ∪ (the target's
current cluster-global state)**, passed as `PlanOptions.baseline`:
- shadow bootstrap roles (`postgres`, …) are in the baseline ⇒ **not** created on
  the target;
- the target's existing roles are in the baseline ⇒ **not** dropped;
- owner edges to baselined roles prune ⇒ objects created applier-owned (no owner
  churn);
- a role the files genuinely **declare** is in neither baseline ⇒ survives in
  desired ⇒ `CREATE`d. ✓
- **Limitation (intrinsic to subtraction):** *modifying* a pre-existing role's
  attributes can't be expressed — subtracting the target's copy makes the changed
  role look brand-new (→ `CREATE ROLE` that already exists). Documented contract:
  auto-shadow can add roles and leaves undeclared roles alone, but to **alter** a
  pre-existing role use `--shadow` on a matching cluster.
- **Pro:** correct for the realistic cases (add / leave-undeclared / owners /
  db-local schema), reuses existing machinery, one narrow documented limit.
  **Con:** must construct the union baseline `FactBase` from filtered extractions.

### D. Isolated Docker container + SEED target roles into the shadow
Replicate the target's roles/memberships/configs into the container *before*
loading the files (a mini-apply of the target's cluster-global facts via the
existing role rules). The shadow then holds `role@target-value` + the files'
changes, so the diff yields clean `ALTER` (modify), `CREATE` (add), and no drop
of undeclared roles (they're present on both sides → additive semantics).
- **Pro:** full declarative role fidelity, no limitation. **Con:** materially
  more code + edge cases (superuser-name/owner alignment so the load owns objects
  as the target's applier; membership/config replication; the "additive vs
  authoritative" choice for undeclared roles).

### E. Park — keep `--shadow` required
Ship nothing here; the round-cap fix already landed. Lowest effort.

## Recommendation

**Option C (baseline)**, with **D** as a later upgrade if altering pre-existing
roles via auto-shadow becomes a real requirement. C is the cleanest use of the
existing baseline mechanism, correct for the realistic cases, and its single
limitation is narrow and documentable. If even that is too much for a first cut,
**B** (database-local only + loud refusal) is a perfectly defensible smaller
contract that can be upgraded to C/D later without changing the user-facing
default.

## Implementation sketch (for the recommended path)

1. **`src/cli/docker-shadow.ts`** — drive the `docker` CLI directly (no
   `testcontainers` runtime dep in `src/`):
   - `dockerAvailable()` = `docker version` exits 0.
   - `startDockerShadow(pgMajor, image?)`: `docker run -d --rm --label
     pg-delta-shadow=<runId> -e POSTGRES_PASSWORD=<random> -P
     postgres:<major>-alpine -c fsync=off -c full_page_writes=off -c
     wal_level=logical`; read mapped port via `docker port`; connect-and-retry
     readiness; `stop()` = `docker rm -f` (idempotent) + `SIGINT`/`SIGTERM`
     handlers; age-guarded startup sweep of stale labeled containers for
     `SIGKILL`-leak reclaim.
   - `image` overridable via `--shadow-image` (Supabase / extension-heavy
     schemas need a custom base; a stock image fails loudly on a missing
     extension rather than mis-diffing).
2. **`src/cli/commands/schema.ts` — `cmdSchemaApply`**:
   - `--shadow` optional; add `--shadow-image`, `--max-rounds`.
   - given `--shadow` → current behavior (`databaseScratch` mode).
   - omitted + Docker available → probe target major, `startDockerShadow`,
     `isolatedCluster` mode; build the union baseline (pristine snapshot +
     target cluster-global extraction filtered to cluster-global kinds) and pass
     via `planOptions.baseline`; refuse with a clear message + pointer to
     `--shadow` if the before/after snapshot shows an *altered* pre-existing role
     (the case baseline can't express); teardown in `finally`.
   - omitted + Docker absent → exit 2 with `--shadow` fallback instructions.
3. **Baseline construction helper** — filter a `FactBase` to cluster-global kinds
   (+ their edges) and `buildFactBase` the subset; union pristine + target.

## Open questions

- Exact set of "cluster-global" kinds to baseline/scope (role, membership,
  defaultPrivilege; tablespaces/parameters are out of model scope today).
- Whether to also align the container superuser name to the target's applier, or
  rely purely on owner-edge pruning (the latter seems sufficient under C).
- Supabase profile: a stock image won't carry Supabase extensions; likely needs
  the profile to declare a shadow image, or require `--shadow` for Supabase.
- `testcontainers` (already a dev dep, has the Ryuk reaper for leak cleanup) vs
  the `docker` CLI shell-out (no `src/` runtime dep). Leaning shell-out for a
  clean `src/` boundary.

## Tests (when implemented)

- Auto-shadow happy path: `schema apply` with no `--shadow` applies db-local
  schema; the labeled container is gone afterward (no leak).
- Add-role via files converges; undeclared target roles are left untouched;
  no spurious owner churn (option C).
- Alter-pre-existing-role is refused with a clear `--shadow` message (option C
  contract) — or works (option D).
- `dockerAvailable() === false` → exit 2 with fallback instructions.
