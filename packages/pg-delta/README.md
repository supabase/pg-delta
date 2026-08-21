# @supabase/pg-delta

Compare two PostgreSQL schemas, emit an ordered DDL migration — and **prove**
that migration converges, with your data intact, before you trust it.

`pg-delta` never parses SQL to understand it. Every state is resolved by a real
PostgreSQL instance (a live database, or a shadow database populated from your
`.sql` files) and read back out of the catalog. The CLI binary is `pgdelta`.

> **Status:** published as a breaking-change alpha (`1.0.0-alpha.x`). This is a
> clean-room rebuild that replaced the legacy engine outright — the CLI, the
> public API, and the persisted artifact formats are all new. Nothing carries
> over. Upgrading from `1.0.0-alpha.33` or earlier? See [MIGRATION.md](./MIGRATION.md).

## Install

```bash
npm install @supabase/pg-delta      # library
npx @supabase/pg-delta --help       # CLI, no install
```

Requires Node.js >= 20. Also runs on Bun and Deno.

## Quick start

**Diff two databases and apply the result:**

```bash
pgdelta plan --source postgres://…/current --desired postgres://…/target --out plan.json
pgdelta render --plan plan.json --out migration.sql   # review the SQL
pgdelta apply  --plan plan.json --target postgres://…/current
```

**Keep your schema as `.sql` files:**

```bash
pgdelta schema export --source postgres://…/db --out-dir ./schema
# …edit ./schema/**.sql…
pgdelta schema apply  --dir ./schema --shadow postgres://…/scratch --target postgres://…/db
```

**As a library:**

```ts
import { extract } from "@supabase/pg-delta/extract";
import { plan } from "@supabase/pg-delta/plan";
import { apply } from "@supabase/pg-delta/apply";
import { provePlan } from "@supabase/pg-delta/proof";

const source = await extract(sourcePool);
const desired = await extract(desiredPool);

const migration = plan(source.factBase, desired.factBase);
await provePlan(migration, clonePool, desired.factBase); // optional but recommended
await apply(migration, sourcePool);
```

## Commands

| Command | What it does |
|---|---|
| `plan` | Diff two databases → a versioned plan artifact |
| `apply` | Execute a plan against a target (fingerprint-gated) |
| `render` | Write a plan out as reviewable `.sql` |
| `prove` | Apply a plan to a clone and verify convergence + data preservation |
| `diff` | Human-readable difference summary, no artifact |
| `drift` | Compare a live database against a saved snapshot |
| `snapshot` | Serialize a database's fact base to a file |
| `schema export` | Write a database out as declarative `.sql` files |
| `schema apply` | Load `.sql` files into a shadow, then plan/apply against a target |
| `schema lint` | Statically check `.sql` files for load-order problems (no database) |

Run `pgdelta <command> --help` for flags.

## How it works

```mermaid
flowchart TB
    EXTRACT["<b>extract</b> — read a database into a fact base<br/><i>one content-addressed fact per table, column, constraint, policy, grant, …</i>"]
    DIFF["<b>diff</b> — compare two fact bases → deltas<br/><i>generic; zero per-object-type code</i>"]
    PLAN["<b>plan</b> — deltas → ordered atomic DDL actions<br/><i>one rule table, one dependency graph, one deterministic sort</i>"]
    PROVE["<b>prove</b> — apply to a throwaway clone, re-extract, compare"]
    APPLY["<b>apply</b> — execute against the real target"]
    EXTRACT --> DIFF --> PLAN --> PROVE --> APPLY
```

Because everything lives at one grain — the fact — the diff needs no per-kind
code and the ordering needs no cycle-breakers.

**The proof loop** is what makes a plan trustworthy. It applies the plan to a
clone, re-extracts, and checks two things: **state** (zero drift deltas against
the desired fact base) and **data** (rows survive). It reports honest per-table
coverage rather than a bare boolean — `contentMode` is `fingerprint` for a
non-empty table whose schema is unchanged, `count` for one whose schema changed,
and `none` for an empty table. `ok` means "everything checked passed", not
"everything is fine"; seed your tables to give it teeth.

## What's covered

Schemas, roles (incl. configs and memberships), default privileges, extensions,
tables (incl. partitioned, `INHERITS`, replica identity), columns, defaults,
constraints (table + domain), indexes, sequences, views, materialized views,
functions, procedures, aggregates, triggers, policies, rewrite rules, event
triggers, domains, enum/composite/range types, collations, publications,
subscriptions, FDWs/servers/user-mappings/foreign tables, comments, ACLs, and
security labels.

Object kinds the engine doesn't model — casts, operators, text-search
configuration, statistics objects, languages, transforms — are **detected and
reported** as `unmodeled_kind` diagnostics, never silently dropped.
See [COVERAGE.md](./COVERAGE.md) for the authoritative map and the deliberate
exclusions, and `_custom/` below for where that SQL lives.

## Export tree layout

`schema export` writes one directory per schema at the root of the output
directory, plus a reserved `_cluster/` directory for the cluster-level objects
that belong to no schema:

```text
schema/
  _cluster/
    roles.sql                 ← cluster-global roles/memberships appear under
    publications.sql             --scope cluster (the default --scope database
    extensions/pgcrypto.sql      omits them)
  app/
    schema.sql
    tables/users.sql          ← columns, defaults, constraints, indexes,
    views/user_notes.sql         triggers and policies live with their relation
    functions/add.sql
```

Two flags shape this tree, and they compose:

- `--path-style flat|nested` — where the two **root** segments live. `flat` is
  the default (shown above). `nested` reproduces the historical
  `schemas/app/tables/users.sql` + `cluster/roles.sql` tree, for tooling that
  pins those paths. Nothing below the root segment differs.
  A schema named `_cluster` or `_custom` — the two reserved root directories —
  or any case variant of one escapes its leading underscore under `flat`
  (`%5Fcluster/`, `%5FCUSTOM/`), so it can never claim, or case-fold into, a
  directory the export owns.
- `--layout by-object|ordered|grouped` — how statements are distributed across
  files: one file per object (default), numbered files in dependency order, or
  the category-ordered "nice" export with opt-in grouping.

The loader is structure-agnostic — `schema apply --dir` reads every `.sql`
under the directory recursively — so the layout is purely a readability
choice. `load(export(db)) ≡ db` holds for every combination.

## `_custom/` — the escape hatch inside an export

`schema export` owns its output directory: it prunes what a previous export
owned and refuses when it finds a `.sql` it does not own. The one exception is
`_custom/`, a reserved directory at the root of the tree:

```text
schema/
  _custom/           ← yours; never written to, never pruned, never refused on
    README.md        ← scaffolded on export, documents this contract
    text-search.sql
  _cluster/…         ← regenerated on every export (roles, publications, …)
  public/…           ← one directory per schema
  app/…
  .pgdelta-export.json
```

Put there the SQL pg-delta detects but doesn't model (the `unmodeled_kind`
kinds) plus idempotent DML — and keep modeled DDL out (`schema lint` warns).

- **Loaded into the shadow, not the target.** `schema apply` loads
  `_custom/**/*.sql` into the shadow, so modeled objects that depend on
  unmodeled ones (an index over a custom text search configuration, say)
  elaborate correctly. It is never executed against the target: unmodeled
  objects produce no facts, so they cannot enter a plan. Deliver the same change
  through your normal migration channel.
- **Record the twin migration** as a head-of-file comment —
  `-- pgdelta-migration: ../../supabase/migrations/20260811_add_cast.sql`, or
  `-- pgdelta-migration: none` for a file that deliberately has no twin.
  `schema lint` reports missing, dangling and conflicting references, and
  modeled DDL parked in the folder, as warnings.

Because the folder feeds only the shadow, planning **pre-flights the gap it
creates**: an `unmodeled_drift` warning (printed under the `[drift]` label) names
every unmodeled object the shadow has and the target lacks — `3 unmodeled "cast"
objects exist in the desired state (shadow) but NOT on the target (…)`. No
planned statement can create one (unmodeled kinds produce no facts), so a
statement that depends on one fails on the target; deliver it through your
migration channel first. It is catalog-sourced (no SQL parsing), non-blocking by
default, and blocking under `--strict-coverage`.

Frontends that own the migration channel can automate delivery instead of asking
the user to. `listCustomFiles(root)` (from `@supabase/pg-delta/frontends`)
returns every `_custom/**/*.sql` with its
body and parsed directives, plus a `delivered` flag (a recorded migration, or an
explicit `none`); a frontend appends the undelivered ones to the catch-up
migration it already generates and stamps the directive back, taking run-once
semantics from its own migration ledger. pg-delta still executes nothing.

Under such a frontend the user never maintains the directive by hand, so
`schema lint --custom-migration-refs off` silences `custom_missing_migration_ref`
alone — the dangling and conflicting rules always fire, because a recorded-but-
wrong reference is a bug whoever wrote it.

Full contract: [custom-folder.md](https://github.com/supabase/pg-toolbelt/blob/main/docs/architecture/custom-folder.md).

## Integration profiles

`--profile raw | supabase | <path-to-custom>` declares what the engine manages.
A profile carries policy rules (which objects are yours vs. the platform's),
extension intent handlers (`pg_cron`, `pg_partman`), assumed schemas and roles,
and secret redaction (FDW options, subscription conninfo). A custom profile can
also declare a **baseline** — a snapshot subtracted from both sides so platform
objects stay invisible with no per-command flag. The baseline's digest is
stamped on plan and export artifacts and reconciled at apply/prove, so
`plan == prove == apply` holds and a swapped or edited baseline fails loudly.

## Statement reordering assist (opt-in)

`loadSqlFiles` is parser-free: it sequences whole *files* into the shadow, so it
tolerates cross-file disorder. It never permutes statements inside a file.
When a file cannot commit atomically, `statementFallback` (default on) keeps
the prefix Postgres already accepted and retries the **remaining** statements
in authored order after other files have progressed — it does not sort the
file. Pass `false` for whole-file rollback. Files that contain session-setting
statements (`SET search_path`, `SET ROLE`, any `SET LOCAL`, …) or
`ALTER DEFAULT PRIVILEGES` stay file-atomic so those settings cannot expire
or apply to sibling files' objects.

The opt-in reordering assist is what actually reorders within a file: it
splits files into one-statement units and topologically pre-sorts them via
[`@supabase/pg-topo`](https://www.npmjs.com/package/@supabase/pg-topo).

- **Subpath:** `@supabase/pg-delta/sql-order` exposes `orderForShadow(files)` /
  `analyzeForShadow(files)`, `canReorder()`, and the typed
  `ReorderUnavailableError`.
- **Dependency posture:** `@supabase/pg-topo` is an **optional peer**, loaded
  only through a guarded dynamic `import()`. Importing the core never pulls the
  libpg-query WASM parser. If the peer is absent the subpath throws with an
  install hint; `canReorder()` probes instead.
- **CLI:** `schema apply` runs the assist by default (`--no-reorder` opts out).
  `schema lint --dir <dir>` runs the analyzer statically, with no database.

## Documentation

| | |
|---|---|
| Using it — CLI and API | [getting-started.md](https://github.com/supabase/pg-toolbelt/blob/main/docs/getting-started.md) |
| Why it was rebuilt | [overview.md](https://github.com/supabase/pg-toolbelt/blob/main/docs/overview.md) |
| How it works, in depth | [architecture/](https://github.com/supabase/pg-toolbelt/tree/main/docs/architecture) |
| What it models, and what it doesn't | [COVERAGE.md](./COVERAGE.md) |
| Upgrading from the legacy engine | [MIGRATION.md](./MIGRATION.md) |

## Development

```bash
bun test src/                                            # unit tests, no Docker
bun test tests/                                          # integration, Docker required
bun run check-types

PGDELTA_TEST_IMAGE=postgres:15-alpine bun test tests/    # pick a PG version
PGDELTA_NEXT_ONLY=enum bun test tests/engine.test.ts     # one corpus subset
PGDELTA_NEXT_SHARD=0/4 bun test tests/engine.test.ts     # one shard
PGDELTA_NEXT_SOAK=200 bun test tests/generative.test.ts  # bigger generative soak
bun scripts/benchmark.ts                                 # timing numbers
```

The **corpus** (`corpus/`, 331 scenarios) is the primary correctness gate: every
scenario is proven in both directions, with compact and uncompacted plan
artifacts built and applied independently — so compaction is enforced as
cosmetic rather than load-bearing. CI runs it across PostgreSQL 14–18.

Compaction is on by default (`--no-compact` opts out) and folds column clauses
into `CREATE TABLE`, elides redundant drops and default-ACL churn, and folds
co-created ownership into the `CREATE`.

## License

MIT
