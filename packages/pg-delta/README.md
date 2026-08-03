# @supabase/pg-delta

Compare two PostgreSQL schemas, emit an ordered DDL migration — and **prove**
that migration converges, with your data intact, before you trust it.

`pg-delta` never parses SQL to understand it. Every state is resolved by a real
PostgreSQL instance (a live database, or a shadow database populated from your
`.sql` files) and read back out of the catalog. The CLI binary is `pgdelta`.

> **Status:** published as a breaking-change alpha (`1.0.0-alpha.x`). This is a
> clean-room rebuild that replaced the legacy engine outright — the CLI, the
> public API, and the persisted artifact formats are all new. Nothing carries
> over. Upgrading from `1.0.0-alpha.31` or earlier? See [MIGRATION.md](./MIGRATION.md).

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

```text
extract   read a database into a fact base
          (one content-addressed fact per table, column, constraint, policy, grant, …)
   ↓
diff      compare two fact bases → deltas (generic; zero per-object-type code)
   ↓
plan      deltas → ordered atomic DDL actions
          (one rule table, one dependency graph, one deterministic sort)
   ↓
prove     apply to a throwaway clone, re-extract, compare
   ↓
apply     execute against the real target
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
exclusions.

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
tolerates cross-file disorder but cannot reorder statements *within* a file. The
opt-in reordering assist splits files into one-statement units and topologically
pre-sorts them via [`@supabase/pg-topo`](https://www.npmjs.com/package/@supabase/pg-topo).

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
| Using it — CLI and API | [getting-started.md](../../docs/getting-started.md) |
| Why it was rebuilt | [overview.md](../../docs/overview.md) |
| How it works, in depth | [architecture/](../../docs/architecture/) |
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

The **corpus** (`corpus/`, 321 scenarios) is the primary correctness gate: every
scenario is proven in both directions, with compact and uncompacted plan
artifacts built and applied independently — so compaction is enforced as
cosmetic rather than load-bearing. CI runs it across PostgreSQL 14–18.

Compaction is on by default (`--no-compact` opts out) and folds column clauses
into `CREATE TABLE`, elides redundant drops and default-ACL churn, and folds
co-created ownership into the `CREATE`.

## License

MIT
