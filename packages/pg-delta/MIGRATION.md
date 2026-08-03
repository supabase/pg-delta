# Migrating from the legacy `@supabase/pg-delta` engine

`@supabase/pg-delta` is now a clean-room rebuild. It kept the package name and
the `pgdelta` binary, but the CLI, the public API, and every persisted artifact
format are new — nothing carries over for compatibility. The legacy engine
remains on npm as `1.0.0-alpha.31` and in git history.

This guide maps the old surface onto the new one.

## API mapping

| Old call | New call | Notes |
|---|---|---|
| `extractCatalog(pool)` | `extract(pool)` → `{ factBase, pgVersion }` | catalogs are gone; the fact base is the only state model |
| `createPlan(source, target, opts)` | `plan(extract(source).factBase, extract(target).factBase, opts)` | plan is pure — extraction is explicit and reusable |
| `applyPlan(plan, pool)` | `apply(plan, pool, { fingerprintGate? })` | the gate re-extracts and refuses stale plans by default |
| `plan.statements` / serialized SQL list | `plan.actions[].sql` + `serializePlan(plan)` | plans are version-tagged JSON artifacts, never bare SQL lists |
| post-apply verification (built into applyPlan) | `provePlan(plan, clonePool, desiredFactBase)` | opt-in, and stronger: state proof + data-preservation proof |
| `declarativeApply(files, pool)` (round-apply against live targets) | `loadSqlFiles(files, shadowPool)` → `plan` → `apply` | bounded rounds run against a throwaway shadow ONLY; the live target gets a planned, provable artifact |
| `catalog-export` CLI | `pgdelta snapshot` | snapshots are fact bases with digest verification |
| filter DSL (`IntegrationDSL`) | policy DSL v2 (`Policy` in `src/policy/policy.ts`) | see the cookbook below |
| `supabase` integration | `supabasePolicy` (`src/policy/supabase.ts`) | the module docblock carries the rule-by-rule mapping table |

## Plan artifact differences

- The artifact is JSON with `formatVersion: 1` and `engineVersion`;
  `apply` refuses artifacts it does not understand. Old plans are not
  readable — re-plan.
- `source.fingerprint` / `target.fingerprint` are fact-base rollup
  digests. Apply gates on the source fingerprint by default.
- Every action carries `produces` / `consumes` / `destroys` /
  `releases` fact ids, a vetted `lockClass` (reported, not certified),
  three-valued `transactionality`, `dataLoss`, and `rewriteRisk`. The
  plan-level `safetyReport` aggregates them.
- `filteredDeltas` lists what the policy hid — drift you chose not to
  manage is still drift you can ask about.
- `renameCandidates` carries the rename verdicts (including
  near-miss explanations).

## Output shape: the biggest consumer surprise

The new engine emits **maximally decomposed** DDL, then compacts the
merges that matter for readability (column definitions fold into
`CREATE TABLE` when no dependency edge crosses the merge). Differences
you WILL see against old-engine output:

1. Constraints are separate `ALTER TABLE … ADD CONSTRAINT` statements
   (FKs always — that is what makes mutual-FK teardown cycles
   unconstructible).
2. ACLs normalize through `acldefault()`: a plan may contain
   REVOKE-then-GRANT pairs that instantiate an owner's implicit
   privileges. The resulting state is identical; the bytes differ.
3. Enum value removal is a rename-aside migration
   (`ALTER TYPE … RENAME TO … __pgdelta_replaced`, `CREATE TYPE`,
   per-column `USING … ::text::…` casts, `DROP TYPE`), with dependent
   views/defaults/routines force-rebuilt around it. The old engine
   refused these.
4. `ALTER TYPE … ADD VALUE` plans may apply across MORE THAN ONE
   transaction (a commit boundary is placed before the first consumer
   of the new value). Mid-plan failure reporting tells you exactly
   which actions are applied/unapplied/in doubt.
5. Plans never contain `SET check_function_bodies` statements — session
   settings ride in `plan.preamble`.

Accepted differences (each is deliberate; none changes converged
state): decomposed-then-compacted statement shapes (1), ACL
instantiation pairs (2), the enum migration sequence (3).

## Policy DSL v1 → v2 cookbook

v2 is typed, serializable data over the fact model — no pattern-string
paths, no function escape hatches.

| v1 | v2 |
|---|---|
| `{ "*/schema": ["auth", …] }` | `{ match: { schema: ["auth", …] }, action: "exclude" }` |
| `{ "schema/name": [...] }` | `{ match: { all: [{ kind: "schema" }, { name: [...] }] }, action: "exclude" }` |
| `{ "*/owner": [...] }` | `{ match: { owner: [...] }, action: "exclude" }` |
| `{ objectType: "extension", operation: "create" }` | `{ match: { all: [{ kind: "extension" }, { verb: "add" }] }, action: "include" }` |
| `or` / `and` / `not` | `any` / `all` / `not` |
| allow-list evaluation | ordered rules, first-match-wins, no-match = include |
| `emptyCatalog` snapshot | `baseline` ref + `subtractBaseline(fb, baseline)` |
| serialize options (`skipAuthorization`) | `serialize: [{ match, params }]` — params validated against the rule table |

Provenance is first-class: `{ ownedByExtension: "postgres_fdw" }` and
`{ edgeTo: { kind: "extension" } }` replace extraction-time suppression.

## Snapshots

Old `catalog-export` JSON is not readable. Regenerate:
`pgdelta snapshot --source <url> --out baseline.json`. Snapshots
embed a format version and digest; corrupted or foreign-version files
refuse to load. The Supabase platform baselines are regenerated with
`scripts/generate-supabase-baseline.ts` against the pinned image tag.

## Known gaps

Object kinds the new engine does not model — casts, operators, text-search
configuration, statistics objects, languages, transforms — are **detected and
reported** as `unmodeled_kind` diagnostics rather than silently dropped, and
`--strict-coverage` refuses to produce an apply artifact while any exist. See
[COVERAGE.md](./COVERAGE.md) for the authoritative map.
