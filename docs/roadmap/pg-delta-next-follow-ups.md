# pg-delta-next — known pitfalls & follow-ups

Captured from the code review of PR #315 (orderless declarative apply, grouped
export, formatting, redaction). These are **known, accepted** at merge time —
recorded here so they aren't rediscovered. Nothing below blocks the stacked
`feat/pg-delta-next` line from landing, but each should be picked up before the
engine is promoted past preview.

Severity legend: **P1** correctness/safety, **P2** contract/coverage gap,
**P3** cleanup/maintainability.

## P1 — correctness & safety

### Co-located shadow can execute cluster-global DDL against the live cluster — ✅ core hole fixed in this PR

`packages/pg-delta-next/src/frontends/load-sql-files.ts` applies each file inside
`BEGIN`/`COMMIT`, which already blocks every cluster-global non-transactional
statement (`ALTER SYSTEM`, `CREATE/DROP DATABASE`, `CREATE/DROP TABLESPACE`,
`VACUUM`, …) with `SQLSTATE 25001`. The actual escape was the 25001 **raw
fallback**: `applyFile` re-ran the offending single statement via
`client.query(sql)` *outside* the transaction, so on a co-located shadow (which
shares the target's live cluster) those statements executed against the customer's
cluster and persisted after the shadow was dropped.

**Fixed:** the raw fallback is now gated by `RAW_FALLBACK_ALLOWLIST` — one entry,
`CREATE INDEX CONCURRENTLY`, the only non-transactional statement a declarative
schema legitimately contains. Every other 25001-raiser is refused with a
`ShadowLoadError` (`unsupported_non_transactional`) instead of running
unsandboxed; this also closes `CREATE SUBSCRIPTION (connect = true)` opening a
live replication connection from the shadow. Deterministic loader refusals now
rethrow immediately rather than being retried until the round budget exhausts.
Regression coverage in `tests/load-sql-files-atomicity.test.ts` (a `VACUUM` file
is refused; a `CREATE DATABASE` file is refused and never creates the sibling
database; `CREATE INDEX CONCURRENTLY` still loads).

**Deliberately not done (low likelihood — see review discussion):** the engine
never emits these statements and Supabase declarative schemas realistically never
contain them (on managed Supabase the applier isn't even superuser, so they fail
permission-denied rather than leak). So the two heavier layers from the design
were skipped:

- Extending `CLUSTER_DDL_RULES` / flipping it to an allowlist for an *up-front*
  refusal (before the shadow is provisioned) and to also catch the *transactional*
  cluster-global forms (`ALTER DATABASE … SET`, `GRANT … ON DATABASE`).
- Post-load `pg_database` / `pg_tablespace` snapshot checks (mirroring the
  existing role-leak snapshot) to catch dynamic-SQL-smuggled transactional forms.

The genuinely airtight fix remains the isolated ephemeral cluster in
[ephemeral-shadow-design.md](ephemeral-shadow-design.md); the fallback allowlist
is correct and useful regardless of whether that lands.

### pg-topo total-order change flips pg-delta declarative-apply on cycles — ✅ resolved in this PR

`packages/pg-topo/src/analyze-and-sort.ts` now returns `ordered` as a **total
order** that appends dependency-cycle members, where it previously returned only
the acyclic-drainable prefix (cycle members surfaced separately via
`cycleGroups`). `@supabase/pg-topo` is a published package and
`packages/pg-delta/src/core/declarative-apply` consumes `ordered` directly: on a
genuine cycle its status now flips from silent-success-with-fewer-statements to
`stuck` — the correct outcome, since an unbreakable cycle cannot be applied and
should fail loudly rather than silently drop statements.

**Resolved:**

- Semver: the changeset (`.changeset/pg-topo-total-ordered.md`) is bumped from
  patch to **minor** and its wording now spells out the consumer-observable
  behavior change (declarative apply reports `stuck` on a true cycle instead of
  a partial success).
- Coverage: `packages/pg-delta/tests/integration/declarative-apply.test.ts` now
  has a cycle case (mutual-FK tables) asserting every input statement reaches
  the applier (`totalStatements === 3`), a `CYCLE_DETECTED` diagnostic, and a
  `stuck` result. Verified RED against the pre-total-order behavior
  (`totalStatements` was `1` — the two cyclic tables were dropped from
  `ordered`).

### Formatter strands the action keyword on every `ALTER TABLE` under `--format` — ✅ resolved in this PR

In `packages/pg-delta-next/src/frontends/sql-format/`, `scanTokens` drops
double-quoted identifiers, so `formatAlterTable`'s positional cursor landed on
the action keyword and `skipQualifiedName` (`tokenizer.ts`) consumed it. Because
the renderer's `qid()` **always** double-quotes, every engine-rendered
`ALTER TABLE "s"."t" <ACTION> …` hit this when formatting was enabled:

```
ALTER TABLE "public"."users" ADD
    COLUMN a int
```

This affected **all** `ALTER TABLE` forms (`ADD COLUMN`, `ENABLE ROW LEVEL
SECURITY`, `REPLICA IDENTITY`, …) and the sibling `formatAlterGeneric`
(`ALTER MATERIALIZED VIEW`/`DOMAIN`/`FOREIGN TABLE`/…).

**Fixed:** both `formatAlterTable` and `formatAlterGeneric` now find the name's
true end from the raw statement via `qualifiedNameEnd` (the helper the
CREATE-family formatters already use), instead of positional token indexing.
Regression coverage lives in `format-quoted-names.test.ts`.

**Remaining follow-up (same root cause, different symptom):**
`keyword-case.ts` (`isCaseableInContext` / the ALTER handler around line 846)
still uses `skipQualifiedName` to find the action-token region, so for a
quoted-name `ALTER TABLE` the per-action keyword-casing loop starts one token
late and can skip casing the first action keyword. Lower severity (casing, not
stranding) — fix it the same way (anchor on `qualifiedNameEnd`) when the
keyword-case pass is next touched.

## P2 — contract & coverage gaps

### pg-delta CI does not re-run on pg-topo changes — ✅ resolved in this PR

`.github/workflows/tests.yml` gated the pg-delta unit/integration/check-types
jobs on `packages/pg-delta/**` (or root) only. A pg-topo-only change — like this
PR's `ordered` contract change — never re-ran pg-delta's suites, even though
pg-delta imports `@supabase/pg-topo` at runtime. (The merge queue forces all
outputs true, so the gap was real at PR-review time but masked at merge time.)

**Fixed:** the `pg-delta` check-types step, `pg-delta-unit`,
`pg-delta-test-image-hash`, and `pg-delta-integration` jobs now also fire on
`needs.detect-changes.outputs.pg-topo == 'true'`. The `detect-changes` action
already emitted a `pg-topo` output, so no filter change was needed. `knip
(pg-delta)` was intentionally left on the pg-delta-only gate — it inspects
pg-delta's own unused code, which a pg-topo change cannot affect.

### Changesets version a private package — ✅ resolved in this PR

55 changesets target `@supabase/pg-delta-next`, which is `"private": true` /
`0.0.0`. The repo is in changeset pre-release (alpha) mode and
`.changeset/pre.json`'s `initialVersions` doesn't list pg-delta-next, so
`changeset status` planned a **minor** bump for it — the release workflow would
have consumed all 55 into a `chore: release` PR that bumps the unpublishable
package and writes a large CHANGELOG (`changeset publish` skips private packages,
so this was churn, not breakage).

**Fixed:** added `@supabase/pg-delta-next` to `.changeset/config.json` `ignore`.
This is safe and non-destructive — all 55 changesets are standalone (they
reference no other package) and no published package depends on pg-delta-next, so
`ignore` neither errors nor cascades. The changesets are preserved (ignored
changesets aren't consumed) and `changeset status` now plans only
`@supabase/pg-topo` (patch). When pg-delta-next is eventually published, remove
it from `ignore` to release the accumulated history.

### `elideCascadeSubsumedPolicyDrops` ignores policy→role references

`packages/pg-delta-next/src/plan/internal.ts` judges whether a dropped object is
load-bearing from `pg_depend` edges only. A policy's referenced roles live in
`pg_shdepend` and are carried on the fact payload (`roles`), not as graph edges,
so a role-referencing policy's `DROP POLICY` can be elided as cascade-subsumed.
The `DROP OWNED BY <role>; DROP ROLE <role>` sequence in `rules/roles.ts` covers
the general case, but the sole-role-in-policy ordering is untested
(`policy-drop-compaction.test.ts` covers only the view case). **Follow-up:** add
the role scenario to the corpus.

### `elideCoCreateRevokeBeforeGrant` guard reads only desired facts

The `defaultGrantsOutside` guard in `internal.ts` inspects only **desired**
`defaultPrivilege` facts, so a *source-only* `ALTER DEFAULT PRIVILEGES` being
dropped in the same plan can still fire at create time — leaving the applied ACL
a superset of desired. The proof loop diffs ACLs post-apply, so any
corpus-covered scenario is safe; an uncovered one ships undetected.
**Follow-up:** add a corpus scenario that drops a source-only ADP alongside a
co-created grant.

### pgmq tables excluded by a name-glob bandaid

`packages/pg-delta-next/src/policy/supabase.ts` re-includes user triggers in
managed schemas, then carves pgmq's `q_*`/`a_*` queue/archive tables back out by
name glob (scoped to the `pgmq` schema). The comment concedes this compensates
for pgmq creating its tables via `pgmq.create()` rather than `CREATE EXTENSION`,
so extract-time `pg_depend` `'e'` membership misses them. If pgmq changes its
internal naming — or a user creates a `q_*` table inside the pgmq schema — the
classification is wrong. **Deeper fix:** tag pgmq-created objects as
extension/owner-owned at extraction time so the generic ownership exclusion
covers them.

### `$1$…$1$` digit dollar-tags mis-scanned

`sql-scanner.ts`'s `readDollarTag` (and the regex in `load-sql-files.ts`) accept
digit-leading dollar tags, so `$1$…$1$` is treated as a dollar-quoted span even
though Postgres parses `$1` as a positional parameter. Unlikely in
engine-rendered SQL; low severity but a real divergence from Postgres
tokenization.

## P3 — cleanup (batch into a follow-up chore PR)

- **Three hand-rolled SQL scanners, two disagreeing.** `walkSql`
  (`sql-scanner.ts`) and `protectDollarQuotes` (`protect.ts`) don't nest-count
  block comments; `maskLiteralsAndComments` (`load-sql-files.ts`) does. Unify on
  one scanner (this also closes the `$1$` item above).
- **`quoteIdent` re-implemented ~6×** (`plan/render.ts`, `core/stable-id.ts`,
  `cli/shadow.ts`, `load-sql-files.ts` ×2, `proof/prove.ts`). Extract one
  helper; runtime/CLI callers can use `escapeIdentifier` from `pg`.
- **`formatMixedItems` is a byte-for-byte duplicate** of `formatKeyValueItems`
  (`format-utils.ts`). Delete it; point its call sites at the original.
- **Dead branches** in `keyword-case.ts` `isCaseableInContext` (`OR`, and
  `AS`+`CREATE`) return the same value as the fall-through default.
- **`cmdSchemaApply` is a ~600-line God-function** (`cli/commands/schema.ts`):
  duplicated role-name derivation, 5× copy-pasted enum-flag validation. Split
  into `parseApplyFlags` / `resolveScopeAndProfile` / `prepareFiles` /
  `resolveShadow` / `runApply`, add a `parseEnumFlag` helper.
- **Perf nits:** `internal.ts` teardown scans the full edge list per destroyed
  id (use the existing `incomingEdgesByEncoded` reverse index, cf.
  `replacement-expansion.ts`); `diff.ts` and `snapshot.ts` sort comparators
  rebuild keys per comparison (Schwartzian transform); `keyword-case.ts` makes
  two full passes (scanTokens + walkSql); `load-sql-files` does 3 round-trips per
  file; `schema.ts` calls `mkdirSync` per exported file.
- **Test/script infra duplicated from pg-delta:** `tests/containers.ts` and
  `scripts/sync-supabase-base-images.ts` re-derive helpers that already exist in
  pg-delta's test/script harness (`ensureSupabaseDbMajorVersion` is already
  exported). `collectSqlFiles` duplicates pg-topo's `discoverSqlFiles`. `hash.ts`
  vs pg-delta `fingerprint.ts` is likely a deliberate independent equality
  surface — add a comment saying so, so nobody "fixes" it by importing.
- **`protect.ts` body-protection kind list** is hand-maintained and disconnected
  from the per-kind rule metadata the renderer uses; drive it from the same
  metadata so the formatter and plan agree on which kinds carry an opaque body.
- **`formatters.ts` repetition:** ~18 hand-written command-prefix guards and a
  copy-pasted parenthesized-list assembly → `matchesPrefix` + `formatParenBlock`
  helpers.
- **`pg-delta-next.yml` uses bare `bun test`.** The repo convention is
  `bun run test`; here the package `test` script carries no extra flags so it is
  harmless, but align it or note the exception explicitly.

## Documented, by-design (no action — recorded so they aren't re-flagged)

- **`rootHash` folds reference-only facts** (`core/fact.ts`). Intentional: the
  apply fingerprint gate relies on it, so a plan is only applicable against the
  same baseline. Consequence: the same database fingerprinted under different
  profiles yields different `rootHash`es, and `view.facts()` includes
  reference-only platform/extension facts. Consumers that care must filter
  `referenceOnly`; the load-bearing ones already do.
- **pg-topo README** states `ordered` "always contains every input statement
  exactly once." Accurate for *statements*, but a file that fails parsing
  contributes zero statement nodes and is therefore absent. pg-delta's
  declarative-apply has no `PARSE_ERROR` fallback, so a parse failure yields a
  silently-incomplete apply reported as success. Doc-wording + consumer-hardening
  follow-up.
- **Deleted dogfood differential harness** (`differential.test.ts`,
  `old-engine.ts`). Not a coverage loss: the new proof loop applies each scenario
  against real Postgres and diffs the resulting facts against ground truth — a
  stronger check than comparing two engines. Only the cross-engine
  *diagnostic-quality* comparison is gone.

## PR #315 review triage (Codex)

**Fixed in this PR (P1):**

- `export-manifest.ts` — fail closed on a malformed manifest.
- `view.ts` — preserve reference-only marks across fact projection.
- `schema.ts` — re-check executable SQL after `--skip-cluster-ddl` stripping.
- `schema.ts` scope-projection vs owner-policy ordering — in progress.
- `load-sql-files.ts` non-role cluster DDL — already closed by the 25001
  fallback allowlist (see the shadow item above).
- `.changeset/pg-topo-total-ordered.md` — already bumped to minor.

**False positive:** `dbdev-roundtrip.test.ts` "missing dbdev fixture helper" —
`scripts/lib/bootstrap-dbdev-fixture.ts` is committed and tracked.

**Deferred P2 (tracked follow-ups; not blocking this PR):**

- `extract/routines.ts` — window functions (`prokind = 'w'`) are extracted as
  facts but the dependency resolver still uses `('f','p','a')`, so a dependent
  ordered before a user window function can fail shadow load. Add `w` to the
  resolver's proc CTE.
- `frontends/seed-assumed-schemas.ts` — quick-mode supabase seeding filters out
  platform extension members (e.g. `pg_graphql`), so a user object referencing
  one fails to load in the co-located shadow. Seed the owning platform extension
  or keep those members.
- `frontends/sql-order.ts` `orderForShadow` — drops parse diagnostics, so a
  library caller can silently pass a partial desired state (same root as the
  pg-topo PARSE_ERROR item above). Return the analysis or throw on blocking
  diagnostics.
- `cli/commands/schema.ts` — co-located shadow lifecycle: `process.exit` skips
  the `finally` that drops `pgdelta_shadow_*` (Bun); `--isolated-shadow` on the
  co-located path skips the role-leak snapshot; dynamic (DO-block) cluster DDL
  isn't contained. (Related to the deferred shadow-hardening layers above.)
- Redaction/legacy-snapshot handling: `apply.ts`, `drift.ts`, `schema.ts` —
  treat legacy (unstamped) snapshots/exports as unredacted; `routines.ts` reject
  snapshots missing routine metadata.
- `plan/rules/helpers.ts` / `frontends/export-sql-files.ts` — preserve built-in
  defaults when dropping ADPs; avoid seeding non-ambient reference-only facts.
- Test hygiene: `redaction-output.test.ts` and `policy.test.ts` create databases
  / roles on the shared cluster without dropping them (leak); the
  `privilege-operations--create-grant-drop-unrelated` corpus case needs
  `isolatedCluster: true` so the CREATE ROLE + GRANT ordering is actually tested.
