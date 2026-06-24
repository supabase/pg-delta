# @supabase/pg-delta-next

Clean-room rebuild of pg-delta per [`docs/architecture/target-architecture.md`](../../docs/architecture/target-architecture.md)
(see [the build log](../../docs/build-log.md) for how it was built, stage by
stage). **Working name** — final naming is a stage-10 product decision. Private
until the cutover parity bar.

> **Using it?** See [docs/getting-started.md](../../docs/getting-started.md) for
> the CLI and the programmatic API.

## What works today (proven by the test suite)

The full pipeline, end to end, on the covered kinds:

```text
extract (one consistent txn)  →  fact base (content-addressed, Merkle rollups)
        →  generic diff (fact deltas — zero per-kind code)
        →  rule table → atomic actions → ONE dependency graph → deterministic sort
        →  apply (single txn, per-statement attribution)
        →  provePlan (state proof + data-preservation proof on a TEMPLATE clone)
```

plus the **declarative frontend**: `loadSqlFiles` applies files to a shadow
database with fail-safe ordering (bounded rounds), routine-body
re-validation, shared-object leak detection, and parser-free DML rejection
— then the result flows through the same plan/prove path.

### Statement reordering assist (opt-in)

`loadSqlFiles` is parser-free: it sequences whole *files* into the shadow, so it
tolerates cross-file disorder but cannot reorder statements *within* a file. The
opt-in **statement reordering assist** restores "author in any internal order,
it still loads" by splitting files into one-statement units and topologically
pre-sorting them (via `@supabase/pg-topo`) before the loader runs. See
[target-architecture §4.4.1](../../docs/architecture/target-architecture.md).

- **Subpath:** `@supabase/pg-delta-next/sql-order` exposes
  `orderForShadow(files)` / `analyzeForShadow(files)` (returning single-statement
  `SqlFile`s ready to feed straight into `loadSqlFiles`), `canReorder()`, and the
  typed `ReorderUnavailableError`.
- **Dependency posture:** `@supabase/pg-topo` is an **optional peer dependency**,
  loaded only through a guarded dynamic `import()` when this subpath runs —
  importing the core (`fact` / `diff` / `plan` / `apply` / `loadSqlFiles`) never
  pulls the libpg-query WASM parser. If the peer is absent the subpath throws
  `ReorderUnavailableError` with an install hint; `canReorder()` probes instead.
- **CLI:** `schema apply` runs the assist by default (`--no-reorder` reproduces
  raw file granularity for debugging). On a non-converging load it rewrites
  synthetic ordinal names back to `file:line:col` and attaches any detected
  shadow-load cycle as an advisory hint on top of the authoritative Postgres
  error. `schema lint --dir <dir>` runs the analyzer statically (no database) to
  surface cycles and other diagnostics for proactive authoring — deliberately
  out of the apply path so apply stays Postgres-truth.

- **Corpus proof loop**: every scenario in `corpus/` proven in BOTH
  directions (build and teardown) — state proof = zero drift deltas after
  applying the plan to a clone; data proof = seeded rows survive. The proof
  reports honest per-table **coverage** (`tablesChecked`, `tablesSkipped`,
  and a `contentMode` of `fingerprint` / `count` / `none`) rather than a bare
  boolean: a non-empty table whose schema is unchanged is content-fingerprinted
  (a count-preserving content change is caught); a table whose schema changed
  is count-checked; an empty table is not checked (seed it for teeth). `ok` is
  backed by that coverage — it is not a guarantee beyond what was checked.
- **Fixture-validity layer**: green independently of the engine, so an
  engine failure can never be a broken fixture.
- **Extractor ring**: fixture DDL → asserted facts/payloads/edges,
  deterministic re-extraction, snapshot round-trip, clone fidelity.

## Kind coverage

schema, role (incl. configs), role memberships, default privileges,
extension, table (incl. partitioned/partitions, INHERITS, replica
identity), column, default, constraint (tables + domains), index,
sequence (incl. OWNED BY), view, materialized view, function/procedure,
aggregate, trigger, policy, rewrite rule, event trigger, domain,
enum/composite/range types, collation, publication, subscription,
FDW/server/user-mapping/foreign-table, comments (one global rule),
ACLs (one global rule, REVOKE-first).

The corpus (`corpus/`, ~210 scenarios) is the port of the old pg-delta
integration suite — see `PORTING.md` for the per-case ledger and the
not-ported-with-reason list (Supabase-image, policy-layer/stage-8,
dummy_seclabel, stage-9 renames/export).

## Stage coverage (target-architecture)

All engineering stages are implemented:

- **Stages 0–4** — corpus + EXPECTED_RED ledger, fact core (Merkle
  rollups, snapshots), extractors (one consistent txn, acldefault-
  normalized ACLs), proof harness (state + data preservation), diff.
- **Stage 5** — the rule table, one mixed graph, deterministic sort,
  compaction (column clauses fold into `CREATE TABLE` when no edge
  crosses the merge — cosmetic by contract, proof-stability asserted),
  the vetted lock-class table, the 10k-object benchmark fixture +
  timing harness (`scripts/benchmark.ts`, in CI), the generative engine
  + soak (`tests/generative.test.ts`, scale with `PGDELTA_NEXT_SOAK`).
- **Stage 6** — plan artifact v1 (engineVersion, safetyReport, lossless
  round-trip), segmented executor (three-valued transactionality:
  `CREATE INDEX CONCURRENTLY` runs alone, `ALTER TYPE … ADD VALUE`
  forces a commit boundary before its first consumer), per-action
  applied/unapplied/inDoubt failure reporting, the fingerprint gate,
  session preamble as metadata, render-from-fact-base materialization.
- **Stage 7** — shadow-DB SQL loader + snapshot frontend.
- **Stage 8** — policy DSL v2 (typed serializable predicates,
  first-match-wins, extends with cycle detection), delta filtering with
  reported (never silent) filtered deltas, serialize parameters declared
  by the rule table, baseline subtraction, the Supabase policy package.
- **Stage 9** — rename detection over structural rollups
  (`renames: "auto" | "prompt" | "off"`, ambiguity/near-miss verdicts,
  data preservation proven down to column values), declarative export
  with the `load(export(fb)) ≡ fb` gate (+ an "ordered" layout that
  loads in a single pass), drift, finalized public API (subpath
  exports, reviewed name-by-name in `API-REVIEW.md`), CLI v2.

The proof loop now verifies the two safety fields state-proof alone can't
see (§3.7): **rewrite risk** is observed on the clone (a kept table whose
`relfilenode` changed under no `rewriteRisk`-declaring action fails the
proof) and **data preservation** can be sharpened with opt-in `autoSeed`
(synthetic rows in empty kept tables). Per-kind graph policy
(cascade/rebuild/suppression/defacl) lives entirely in the rule table as
`KindRules` flags — the planner body holds no kind-name lists (guardrail 3).

Every addressable thing is a fact at one grain (§3.1): composite-type
attributes (`typeAttribute`) and publication members (`publicationRel` /
`publicationSchema`) are sub-entity facts, so they diff at sub-entity grain
and are rename candidates — a composite attribute renames in place,
data-preserving, instead of forcing a type rebuild. See `COVERAGE.md` for
the full catalog-coverage map and deliberate exclusions (languages, large
objects, …).

Environment-gated leftovers: security labels are fully modeled and proven
end-to-end (`tests/security-label-proof.test.ts`) against a built
`dummy_seclabel` image (`tests/dummy-seclabel.Dockerfile`); the image builds
on first run and `PGDELTA_SKIP_DUMMY_SECLABEL_BUILD=1` skips it where the
build CDNs are unreachable. The real-Supabase-image baseline proof needs a
Supabase container (mechanism + generation script exist — run
`scripts/generate-supabase-baseline.ts`). Stage 10 (cutover) is a product
decision gated on the parity bar — the differential harness, soak quota at
scale, and naming are deliberately not unilateral engineering calls.

Known v1 simplifications:

- extension members of the common object kinds (tables, sequences, views,
  routines, types, domains, collations, schemas) are observed at extraction
  with `memberOfExtension` provenance edges and projected out by default
  (4b); sub-entity families (columns, constraints, indexes, triggers,
  policies, rules) and rare member-root kinds (fdw, server, foreign table,
  event trigger, publication) are still filtered at extraction — a
  documented, regression-free limitation (see COVERAGE.md)
- capture is serial on one snapshot connection (parallel
  `pg_export_snapshot()` workers are a measured optimization)
- a surviving dependent of a destroyed fact is force-rebuilt when its kind
  declares `rebuildable` in the rule table (view, matview, index, policy,
  trigger, rule, constraint, default, procedure); a non-rebuildable
  survivor whose dependency stays gone fails the plan loudly

## Running

```bash
bun test src/        # unit: codec, hashing, fact base, snapshot, diff, policy
bun test tests/      # integration: Docker required (postgres:17-alpine)
bun run check-types
PGDELTA_TEST_IMAGE=postgres:15-alpine bun test tests/   # other PG versions
PGDELTA_NEXT_ONLY=enum bun test tests/engine.test.ts    # corpus subset
PGDELTA_NEXT_SHARD=0/4 bun test tests/engine.test.ts    # parallel shard
PGDELTA_NEXT_SOAK=200 bun test tests/generative.test.ts # bigger soak
bun scripts/benchmark.ts                                # timing numbers
bun run compare --help                                  # old vs new comparison
bun run dogfood --help                                  # curated dogfood suite
```

See [`docs/dogfooding/pg-delta-next-comparison.md`](../../docs/dogfooding/pg-delta-next-comparison.md) for the evaluation rubric and findings template.

## Dogfooding

Compare old `pg-delta` vs this engine on real projects:

```bash
# Bookmark (live Supabase CLI) — after `supabase start` in bookmark repo
bun run compare \
  --source postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  --desired postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  --scenario bookmark-zero-diff --out-dir /tmp/dogfood --profile supabase

# dbdev-migrations fixture (testcontainer, no live dbdev repo)
bun run compare --fixture dbdev \
  --scenario dbdev-fixture-declarative-roundtrip \
  --out-dir /tmp/dogfood --profile supabase --apply-check --migrations core

# Corpus scenario
bun run compare --corpus table-ops--comments \
  --scenario corpus-comments --out-dir /tmp/dogfood --apply-check

# Full curated suite
bun run dogfood --out-dir docs/dogfooding/runs/$(date +%Y%m%d) --dbdev-scope core

# Interactive HTML review report (charts, side-by-side SQL/diff)
bun run dogfood:report --run-dir ../../docs/dogfooding/runs/suite --open
```

Compaction (cosmetic clause folding + redundant-drop / default-ACL elision) is
**on by default** and proof-stable — the plan converges to the same state either
way. The passes, in order:

- **column folds** — `ADD COLUMN` clauses fold into their bare `CREATE TABLE`
  when no graph edge crosses the merge.
- **redundant-drop elision** — a replace's drop is dropped when the create
  reproduces the byte-identical statement (self-resetting ACL/REVOKE).
- **default-ACL elision** — whole `REVOKE`/`GRANT` groups that only
  re-materialize a freshly-created object's built-in owner/PUBLIC defaults are
  removed.
- **co-create REVOKE elision** — the leading `REVOKE ALL` is trimmed off a
  remaining third-party grant on a co-created object (the `GRANT` is kept), gated
  by a strict-superset guard against any create-time `defaultPrivilege` for the
  applier role.
- **co-create ownership fold** — a co-created object's owner `ALTER` folds into
  its `CREATE`: `CREATE SCHEMA … AUTHORIZATION owner` (always, syntactic), and a
  no-op `ALTER … OWNER TO` is dropped when the desired owner is the applier
  (`capability.role`, probed at apply time).

Pass `--no-compact` to `compare` to emit the maximally-inlined DDL (one
statement per action, every `REVOKE`/`GRANT`/`OWNER TO` spelled out), which is
useful when diffing engine output statement-by-statement.


See `docs/architecture/target-architecture.md` §10. The ones most often relevant here:
no SQL parsing in the trusted path; no per-kind code outside the rule
table; a cycle is a rule bug (there is no breaker module, ever); never
assert SQL bytes in tests — assert state, data survival, or action shape.
