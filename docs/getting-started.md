# Getting started with pgdelta

`pgdelta` turns one PostgreSQL schema into another. You give it a **source**
(where you are) and a **desired** state (where you want to be); it produces an
ordered DDL migration, **proves** that migration converges with your data intact,
and applies it.

You can drive it two ways:

- **The CLI** — `pgdelta <command>` for diffing, planning, proving, applying,
  and a declarative `.sql`-files workflow.
- **The library** — import the pipeline functions (`extract`, `plan`, `apply`,
  `provePlan`, …) and compose them yourself.

> **Status:** `@supabase/pg-delta` is this clean-room engine, published as a
> **breaking-change alpha** (`1.0.0-alpha.x`). It replaced the legacy engine
> outright — the CLI, the public API, and the persisted artifact formats are
> all new; nothing carries over. See [overview.md](overview.md) for the why.

---

## The mental model

Everything flows through one pipeline:

```
extract   read a database into a "fact base" (one fact per object: table,
          column, constraint, policy, grant, … — all content-addressed)
   ↓
diff      compare two fact bases → a list of deltas (add / remove / set / link)
   ↓
plan      turn deltas into ordered, atomic DDL actions (one dependency graph,
          one deterministic sort — no cycle-breakers)
   ↓
prove     apply the plan to a throwaway clone, re-extract, and check the result
          equals the desired state AND seeded rows survived  ← the safety net
   ↓
apply     run the plan against the real target (fingerprint-gated)
```

The desired state can come from **another live database** or from your
**`.sql` files** (loaded into a scratch "shadow" database first — PostgreSQL,
not a SQL parser, elaborates them). Either way the same pipeline runs.

---

## CLI

### Install / run

From the monorepo (Bun):

```bash
bun install
cd packages/pg-delta
bun run src/cli/main.ts <command> [flags]
# or, if linked on your PATH:
pgdelta <command> [flags]
```

`pgdelta help` prints the command list. Exit codes: **0** success,
**1** runtime failure (or drift detected), **2** bad arguments.

### Flow 1 — migrate one database to match another

```bash
# 1. See what would change (human-readable)
pgdelta diff --source "$SOURCE_URL" --desired "$DESIRED_URL"

# 2. Produce a plan artifact (JSON)
pgdelta plan --source "$SOURCE_URL" --desired "$DESIRED_URL" --out plan.json

# 3. (recommended) Prove it on a sacrificial clone of the source
pgdelta snapshot --source "$DESIRED_URL" --out desired.snapshot
pgdelta prove --plan plan.json --clone "$CLONE_URL" --desired-snapshot desired.snapshot

# 4. Apply to the real target (fingerprint-gated against the source it was planned from)
pgdelta apply --plan plan.json --target "$SOURCE_URL"
```

`prove` accepts localhost, loopback addresses, and Unix sockets by default. For
a local container DNS name, add its exact host with
`--trusted-local-host postgres.orb.local`. Any port on that exact host is
accepted, which accommodates dynamically allocated container ports. An
intentional remote clone requires `--allow-remote-clone`. The command refuses
the plan's original source endpoint and verifies both the clone fingerprint and
desired snapshot before auto-seeding or applying any DDL.

Plans containing actions marked `dataLoss:"destructive"` require the separate
`--allow-data-loss` flag at `apply` time. `--force` only bypasses the source
fingerprint check; it never authorizes data loss.

`plan` writes the JSON plan to stdout (or `--out <file>`) and a summary
(action count, filtered deltas, safety report, rename candidates) to stderr.

### Flow 2 — declarative: keep your schema as `.sql` files

Author your schema as ordinary `.sql` files in a directory; order doesn't matter
(the loader resolves dependencies across files in bounded rounds). `schema apply`
loads them into a **shadow** database, extracts that as the desired state, and
migrates the target to match:

```bash
pgdelta schema apply \
  --dir ./schema \
  --shadow "$SHADOW_URL" \   # a fresh, empty database the files are loaded into
  --target "$TARGET_URL"     # the database to migrate
```

Explicit shadows follow the same endpoint policy as proof clones: local by
default, an exact custom hostname via `--trusted-local-host`, or an
intentional remote database via `--allow-remote-shadow`. pg-delta observes both
connections before loading SQL and refuses when shadow and target are the same
database. Cluster scope additionally requires a different PostgreSQL cluster.

Export the inverse — a live database back out to `.sql` files:

```bash
pgdelta schema export --source "$SOURCE_URL" --out-dir ./schema
# --layout by-object (default) groups by schema/kind; --layout ordered emits a
# single load order with the load(export(db)) ≡ db guarantee
#
# --layout grouped restores the old engine's "nice" export: files ordered by
# semantic category, statements sorted within a file for readability, plus
# opt-in grouping:
#   --grouping-mode single-file|subdirectory   (default subdirectory)
#   --group-patterns '[{"pattern":"^auth_","name":"auth"}]'   (first match wins)
#   --flat-schemas partman,audit                (one file per category)
#   --no-group-partitions                       (keep partition children separate)
#
# --format-options pretty-prints the exported SQL (any layout; off by default):
#   --format-options '{"keywordCase":"upper","maxWidth":180}'
# It is cosmetic — the load(export(db)) ≡ db guarantee still holds. The same
# formatter is available as a library helper at @supabase/pg-delta/sql-format
# (formatSqlStatements).
```

> The shadow database must be fresh and empty. When `--shadow` is omitted in
> database scope, pg-delta creates and later drops a co-located scratch database.
> Cluster scope requires an explicit shadow on an isolated PostgreSQL cluster.

### Detect drift from a saved snapshot

```bash
pgdelta snapshot --source "$PROD_URL" --out prod.snapshot   # capture once
pgdelta drift --env "$PROD_URL" --snapshot prod.snapshot    # later: did it change?
```

`drift` exits **0** when the environment still matches the snapshot, **1** when it
has drifted (and prints the deltas) — handy in CI.

### Command reference

| Command | What it does | Key flags |
|---|---|---|
| `diff` | Print the deltas between two live DBs | `--source` `--desired` `[--strict-coverage]` |
| `plan` | Produce a plan artifact (JSON) | `--source` `--desired` `[--out]` `[--profile]` `[--renames]` `[--no-compact]` `[--accept-rename]` `[--restrict-to-applier]` `[--strict-coverage]` |
| `apply` | Apply a plan to a target | `--plan` `--target` `[--profile]` `[--force]` `[--allow-data-loss]` |
| `prove` | Apply a plan to a clone and verify convergence + data preservation | `--plan` `--clone` `--desired-snapshot` `[--profile]` `[--trusted-local-host]` `[--allow-remote-clone]` |
| `snapshot` | Save a database's fact base to a file | `--source` `--out` `[--strict-coverage]` |
| `drift` | Compare a live DB against a saved snapshot | `--env` `--snapshot` `[--strict-coverage]` |
| `schema export` | Export a live DB to `.sql` files | `--source` `--out-dir` `[--layout]` `[--profile]` `[--strict-coverage]` |
| `schema apply` | Load `.sql` files via a shadow DB and migrate a target | `--dir` `--shadow` `--target` `[--renames]` `[--accept-rename]` `[--force]` `[--allow-data-loss]` `[--trusted-local-host]` `[--allow-remote-shadow]` `[--profile]` `[--restrict-to-applier]` `[--strict-coverage]` |

Common flags, explained:

- **`--profile raw\|supabase`** — selects an *integration profile* (default `raw`).
  `supabase` knows about Supabase-managed roles/schemas/extensions and excludes
  them from the diff. See [Profiles](#profiles) below.
- **`--strict-coverage`** — refuse to act while user objects exist in a kind the
  engine doesn't model yet (instead of silently ignoring them).
- **`--renames auto\|prompt\|off`** — `plan`/`schema apply` default to `prompt`,
  which lists rename candidates you confirm with `--accept-rename <from>=<to>`.
- **`--force`** — disables the fingerprint gate on `apply` (see
  [Safety](#safety-features)). Use sparingly.

---

## Programmatic API

The package ships TypeScript source via subpath exports. The everything-entry is
`@supabase/pg-delta`; each stage is also importable on its own
(`/extract`, `/plan`, `/apply`, `/proof`, `/frontends`, `/core`, `/policy`,
`/integrations`).

It takes [`pg`](https://node-postgres.com/) `Pool`s as input.

### Flow 1 — DB to DB

```ts
import { Pool } from "pg";
import { extract } from "@supabase/pg-delta/extract";
import { plan } from "@supabase/pg-delta/plan";
import { apply } from "@supabase/pg-delta/apply";

const source = new Pool({ connectionString: SOURCE_URL });
const desired = new Pool({ connectionString: DESIRED_URL });

// 1. extract both sides into fact bases
const { factBase: sourceFb } = await extract(source);
const { factBase: desiredFb } = await extract(desired);

// 2. plan the migration source → desired
const thePlan = plan(sourceFb, desiredFb);
for (const action of thePlan.actions) console.log(action.sql);
console.log(thePlan.safetyReport); // destructive / rewrite / lock summary

// 3. apply to the target (re-extracts and checks the fingerprint first)
const report = await apply(thePlan, source);
if (report.status !== "applied") throw new Error(report.error?.message);
```

### Prove before you trust it

```ts
import { provePlan } from "@supabase/pg-delta/proof";

// clonePool is a throwaway copy of the source; it WILL be mutated
const verdict = await provePlan(thePlan, clonePool, desiredFb);
if (!verdict.ok) {
  console.error(verdict.driftDeltas);      // what didn't converge
  console.error(verdict.dataViolations);   // rows that vanished
  console.error(verdict.coverage);         // per-table: how it was checked
}
```

### Flow 2 — declarative `.sql` files

```ts
import { loadSqlFiles, exportSqlFiles } from "@supabase/pg-delta/frontends";

// load .sql files into a fresh shadow DB → desired fact base
const { factBase: desiredFb, rounds, diagnostics } = await loadSqlFiles(
  [{ name: "01_tables.sql", sql: "create table t (id int primary key);" }],
  shadowPool,
);

// ...then plan/prove/apply exactly as in Flow 1.

// the inverse: fact base → .sql files
const files = exportSqlFiles(sourceFb, { layout: "by-object" });
```

### Persisting plans and snapshots

```ts
import { serializePlan, parsePlan } from "@supabase/pg-delta/plan";
import { saveSnapshot, loadSnapshot } from "@supabase/pg-delta/frontends";

const json = serializePlan(thePlan);     // plan ↔ JSON round-trips losslessly
const restored = parsePlan(json);

saveSnapshot(sourceFb, "17", "prod.snapshot");
const { factBase } = loadSnapshot("prod.snapshot");
```

### Key types at a glance

- **`FactBase`** — an immutable, content-addressed set of facts + dependency
  edges. Compared by hash.
- **`Plan`** — `{ actions, deltas, filteredDeltas, safetyReport, source, target,
  renameCandidates, … }`. `Action` carries `sql`, `verb`, `transactionality`,
  `lockClass`, `dataLoss`, `rewriteRisk`, and produces/consumes/destroys edges.
- **`ApplyReport`** — `{ status, appliedActions, actionStatuses, error? }`.
- **`ProofVerdict`** — `{ ok, driftDeltas, dataViolations, rewriteViolations,
  coverage, applyError? }`.

---

## Profiles

An **integration profile** bundles "what state the engine manages": which objects
to extract, what to filter, the platform baseline to subtract, and what the
applier can actually execute. The same profile is threaded through extract → plan
→ prove → apply, so *what you prove is exactly what you run*.

```ts
import { resolveProfile, supabaseProfile } from "@supabase/pg-delta/integrations";

const ctx = await resolveProfile(targetPool, supabaseProfile);
const { factBase } = await ctx.extract(targetPool);
const thePlan = plan(sourceFb, factBase, ctx.planOptions);
await apply(thePlan, targetPool, ctx.applyOptions);
```

- **`raw`** (default) — no handlers, no policy: diff everything.
- **`supabase`** — excludes Supabase-managed roles, schemas, and extensions, and
  captures stateful-extension objects (e.g. pg_partman children) so they aren't
  dropped.

On the CLI this is just `--profile supabase`.

---

## Safety features

- **Proof loop** — `prove` (CLI) / `provePlan` (API) is the keystone: a migration
  is only trusted once it has been applied to a clone, re-extracted, and shown to
  converge with data intact.
- **Fingerprint gate** — `apply` re-extracts the target and refuses to run if it
  no longer matches the source the plan was built from (catches drift between
  plan and apply). `--force` disables it.
- **`--strict-coverage`** — fail loudly rather than silently skip objects in
  kinds the engine doesn't model.
- **Honest filtering** — anything a policy filtered out is reported in
  `plan.filteredDeltas`, never silently dropped.

---

## Where to go next

| You want… | Read |
|---|---|
| Why the engine was rebuilt | [overview.md](overview.md) |
| How it works, conceptually | [architecture/README.md](architecture/README.md) |
| The full design (the north star) | [architecture/target-architecture.md](architecture/target-architecture.md) |
| What it models / deliberately excludes | [../packages/pg-delta/COVERAGE.md](../packages/pg-delta/COVERAGE.md) |
| What's left before v1 | [roadmap/v1.md](roadmap/v1.md) |
