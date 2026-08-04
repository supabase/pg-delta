# Design: ephemeral / auto-provisioned shadow for `schema apply`

Status: **design only — not implemented** (deferred). Captures the problem, the
correctness tension we discovered, and the alternatives with trade-offs so
implementation can pick a path later.

See also **"Adjacent proposal: `docker://` URLs and a Supabase shadow image"** at
the end of this doc (triaged 2026-08-03): it accepts `docker://`-style
provisioning and a profile-declared Supabase shadow image, and records why that
image must **not** double as the platform **baseline**.

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
- ~~Supabase profile: a stock image won't carry Supabase extensions; likely needs
  the profile to declare a shadow image, or require `--shadow` for Supabase.~~
  → **Answered**: profile-declared shadow image (+ `--shadow-image` override).
  See "Adjacent proposal" below, which also records why that image must NOT
  double as the baseline.
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

---

## Adjacent proposal: `docker://` URLs and a Supabase shadow image

Triaged **2026-08-03**. Prompted by the question: could pg-delta adopt Atlas's
`--dev-url "docker://postgres/15/dev"` ergonomics, and could we go further with
`docker://supabase/17?services=realtime,auth,…` that runs each service's setup
script to produce **the Supabase baseline**?

Verdict up front: **yes to the provisioning ergonomics, yes to a Supabase shadow
IMAGE, no to deriving the BASELINE from that image.** The last one re-introduces
a data-divergence failure this branch has already diagnosed twice.

### How Atlas's `--dev-url` actually works (for reference)

Worth recording because it is close to, but not the same as, our shadow. Atlas's
`DevDriver` (`sql/internal/sqlx/dev.go`) runs **snapshot → apply → inspect →
restore**: it snapshots the dev DB, creates the desired objects in it for real,
inspects them back (that inspection IS the normalization — Postgres reports the
canonical form), then restores the snapshot and re-patches metadata the
round-trip loses (schema name, user attributes, HCL source positions). It refuses
on a non-empty dev DB (`connected database is not clean`) and has **no locking**
— isolation rests entirely on snapshot/restore. `docker://` simply makes the dev
DB disposable. The URL path selects scope: `…/dev?search_path=public` normalizes
one schema, `…/dev` normalizes a whole realm.

Two differences that matter for us:

- Atlas **restores** its dev DB (reusable); our loader requires the shadow be
  **empty by observation** and treats it as throwaway. Ours is the stricter
  contract and should stay — restore-based reuse is a silent-corruption risk we
  have no need to take.
- Atlas is **scoped-by-default** (`--schema`, `search_path`, `exclude`), so a dev
  container's bootstrap roles are simply outside the selection. pg-delta is
  **authoritative-by-default over the cluster** and relies on the managed view to
  project. That is precisely why the "correctness tension" above is *our*
  problem and not visibly Atlas's: our default scope is bigger. Do not copy
  Atlas's implementation and assume the role problem is handled.

### Accepted: `docker://`-style provisioning (= option C, unchanged)

No new decision needed — this is option C with nicer ergonomics. If we want the
URL form, accept it as a **value of the existing `--shadow` flag** (e.g.
`--shadow "docker://postgres/17-alpine"`) rather than adding a parallel flag, so
there is one shadow concept with two provisioning modes. `--shadow-image` from
the implementation sketch stays as the override for the auto-provisioned case.

### Accepted: a profile-declared shadow IMAGE

This answers the open question above. A stock `postgres:<major>-alpine` shadow
cannot load a file containing `CREATE EXTENSION pg_graphql`, so the Supabase
profile must be able to declare its shadow image (`supabase/postgres:<tag>`),
with `--shadow-image` as the operator override. Failing loudly on a missing
extension (rather than mis-diffing) is already the desired behaviour.

### REJECTED: the shadow image as the source of the BASELINE

#### Why: shadow and baseline answer different questions

Already doctrine in the code — `src/frontends/seed-assumed-schemas.ts`, from the
Codex #323 finding:

> The seed is the **SUPERSET** question — "what platform objects must exist for
> the user SQL to elaborate in the shadow" — whereas the diff is the **SUBSET**
> question — "what do we manage". Only the diff subtracts the baseline.

Their accuracy requirements differ by kind, not by degree:

| | needs to be | tolerates approximation |
|---|---|---|
| **Shadow image** | *close enough* — extensions present, libraries loadable | yes |
| **Baseline** | **exact** — `subtractBaseline` drops facts present **AND identical** (same id + payload hash) | **no** |

One mismatched entry does not subtract; it surfaces as a delta.

#### Why: we have already measured the divergence

From `pg-delta-next-follow-ups.md` § "Supabase roundtrip hardening → Still open":

> **P2 — local-`supabase start` vs Cloud baseline drift.** After all fixes, the
> roundtrip's ONLY residual diff is `schemas/public/default_privileges.sql`: the
> local base-init fixture carries `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" …
> REVOKE ALL … FROM "postgres"` entries the Cloud source project does not. **No
> loader/policy/engine change fixes this** — it is a baseline-DATA divergence
> between local and Cloud provisioning.

So a locally-provisioned Supabase image does **not** reproduce Cloud state today,
measured, for exactly the artifact this proposal would generate — and the failure
lands in **privileges**. The user-visible symptom is pg-delta proposing `REVOKE`s
against production. That is the worst available failure category.

The same lesson was reached independently in P3 (bootstrapped explicit
`--shadow`, deferred):

> a bootstrapped shadow's platform surface matches the **installer era**, not the
> target, so managed-scope divergences would surface as **phantom migrations** —
> strictly more dangerous than the target-derived co-located seed.

#### Why: it is the architecture's own anti-pattern, one level up

`docker://supabase/17?services=…` is a bet that platform state can be
**predicted by re-executing the platform's provisioning**. That is the same shape
of mistake as the old engine re-implementing PostgreSQL's semantics — the thesis
of this rewrite is *don't model it, ask the thing that knows*. Applied here:
do not model what Supabase's platform state **should** be; **measure what the
target's actually is**. The mechanism that already works does exactly that —
`deriveAssumedSchemaSeed(targetResult.factBase, …)` seeds from the target's own
facts and therefore cannot drift, because it *is* the target.

#### Why `&services=…` is additionally unsound as a cache key

Even granting the approach, `services=auth,realtime` does not identify a state:

- **Version skew is 3-dimensional**, not 1: PG major × `supabase/postgres` image
  tag × each service's own independently-advancing migration history.
  `services=auth` does not pin *which* gotrue migrations — that needs
  `auth@<version>`.
- **A Cloud project is not "image + services"**; it is image + services + the
  accumulated history of platform migrations applied over the project's
  lifetime. Two projects on the same PG major, created a year apart, differ. A
  generated-from-latest baseline is correct for neither.
- **It vendors N external migration histories** into a correctness-critical
  runtime input, tracked against Supabase's release cadence forever.
  `scripts/sync-supabase-base-images.ts` already carries this cost for *test
  fixtures*, and the agent guidelines already flag those as
  regenerate-only-never-hand-edit. Promoting that fragility to a runtime input
  is the wrong direction.
- **It puts Docker on `plan`'s critical path**, not just `schema apply`. Docker
  is a dev/test dependency today; a baseline that needs it makes CI and
  production planning depend on Docker plus a multi-GB image pull.

### Recommended sequencing instead

1. **`docker://` auto-shadow + `--shadow-image` (option C).** Pure DX; makes no
   correctness claim about platform state. Supabase profile declares its image.
   Docker optional, clean `--shadow` fallback. Already designed above — build it.
2. **Derive the baseline from the TARGET at plan time, not from an image.**
   Generalize what already works: instead of *matching* against a committed
   snapshot, *classify* which of the target's facts are platform-managed
   (system-role-owned, extension-member, in an assumed schema — Supabase Rules 6 /
   6b already do most of this). This deletes the whole drift class because there
   is nothing to drift *from*. Digest stamping still preserves
   `plan == prove == apply`.
3. **Only if (2) proves impossible: sidecar baselines keyed on an OBSERVED stack
   fingerprint** — which is what the follow-ups doc already calls for
   ("per-stack-fingerprint baselines derived from real Cloud state rather than a
   local-fixture capture"). Published from real Cloud state, with pg-delta
   refusing loudly on an unknown fingerprint. Key on **measured** state, never on
   "image tag + service list": the latter is a guess about provenance, the former
   is a measurement.

### Where an image-derived baseline IS legitimate

Not worthless — mis-scoped. Two valid uses, both of which must stay clearly
distinguishable from the Cloud path at the flag level:

- **Local-only targets.** If the target *is* a local `supabase start`, an
  image-derived baseline matches **by construction**.
- **Test fixtures.** Already done correctly by
  `scripts/sync-supabase-base-images.ts` and
  `scripts/generate-supabase-baseline.ts` (which documents precisely the
  `docker run supabase/postgres` → `pg_bootstrap.sh` → extract → commit flow).

Note `src/policy/baselines/` currently contains only `.gitkeep`, and
`resolveBaseline` **throws** when a policy declares a baseline that is not
committed rather than silently skipping it. That fail-loud default is doing real
work here — preserve it through whatever lands.
