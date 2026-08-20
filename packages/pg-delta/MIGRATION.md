# Migrating from the legacy `@supabase/pg-delta` engine

`@supabase/pg-delta` is now a clean-room rebuild. It kept the package name and
the `pgdelta` binary, but the CLI, the public API, and every persisted artifact
format are new — nothing carries over for compatibility. The legacy engine's
last release is `1.0.0-alpha.33`, which remains installable from npm; its
source is in git history.

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
   settings ride in `plan.preamble`. The `check_function_bodies = off`
   entry appears there only when the plan touches a routine-family
   object (function / procedure / aggregate / extension); planning with
   `compact: false` restores it unconditionally.

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
| `{ "table/is_partition": true }` | `{ match: { partitionOf: {} }, action: "exclude" }` — prefer pinning the parent: `{ partitionOf: { schema: "realtime", name: "messages" } }` |
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

## SSL / `sslmode` semantics

The engine takes caller-built `pg.Pool`s, and node-postgres does **not**
implement libpq's `sslmode` semantics: it treats `sslmode=require` as "encrypt
*and verify the chain* against Node's default trust store", so servers with
private-CA chains (e.g. Supabase-managed databases) are rejected with
`SELF_SIGNED_CERT_IN_CHAIN`. The legacy engine translated `sslmode` internally;
the rebuild initially did not, which regressed `sslmode=require` connections.

- The `pgdelta` CLI and `provisionCoLocatedShadow(targetUrl)` translate
  `sslmode` with libpq semantics again: `require`/`prefer` without a root CA
  encrypt without verification; `require` + `sslrootcert` behaves like
  `verify-ca`; `verify-ca` with a supplied CA verifies the chain but not the
  hostname; `verify-full` verifies both. `PGDELTA_{SOURCE,TARGET}_SSLROOTCERT/
  SSLCERT/SSLKEY` env vars are honored as PEM content fallbacks.
- `verify-ca` **without** any CA deviates from libpq (which errors without a
  root cert): the chain is verified against Node's default trust store with
  hostname verification kept ON — skipping hostname checks against the public
  store would accept any valid public-CA cert for any host.
- **Library consumers building their own pools** get node-postgres' stricter
  behavior unless they opt in: use the exported `parseSslConfig(url, role?)`
  to derive `{ ssl, cleanedUrl }` and build the pool as
  `new pg.Pool({ connectionString: cleanedUrl, ...(ssl !== undefined ? { ssl } : {}) })`
  — the cleaned URL goes under `connectionString`, and `ssl` is spread only
  when defined so passthrough URLs keep node-postgres defaults. Passing
  the raw URL through is the one place the old and new engines still differ.
- `prefer` does not fall back to a plaintext connection when the server
  refuses TLS (libpq retries without SSL; node-postgres has no per-connection
  retry, so `prefer` forces TLS exactly like node-postgres' own and
  pg-connection-string's `uselibpqcompat` handling of that mode).
- One deliberate deviation from legacy: URLs without a recognized `sslmode`
  pass through untouched (legacy forced `ssl: false`), so node-postgres
  defaults — including `PGSSLMODE` env handling — keep applying.

## `loadSqlFiles` statement fallback (default on)

`loadSqlFiles` and `planSchemaFiles` now keep a file's already-accepted
statements when the rest cannot apply in the same transaction (the old
`CREATE SEQUENCE` + `OWNED BY` vs `CREATE TABLE … nextval` split, mixed
`ALTER PUBLICATION … ADD TABLE`). Authored order is unchanged — the remainder
retries after other files land; this is not an intra-file reorder.
`LoadResult.splitFiles` names files demoted this load. Pass
`{ statementFallback: false }` to restore
whole-file rollback and whole-file retry. Files that contain session-setting
statements (`SET search_path`, `SET ROLE`, any `SET LOCAL`, …) or
`ALTER DEFAULT PRIVILEGES` are never split, because those settings would
otherwise expire after the prefix commit or apply to objects created by
sibling files.

## Known gaps

Object kinds the new engine does not model — casts, operators, text-search
configuration, statistics objects, languages, transforms — are **detected and
reported** as `unmodeled_kind` diagnostics rather than silently dropped, and
`--strict-coverage` refuses to produce an apply artifact while any exist. See
[COVERAGE.md](./COVERAGE.md) for the authoritative map.
