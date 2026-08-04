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

55 changesets target `@supabase/pg-delta`, which is `"private": true` /
`0.0.0`. The repo is in changeset pre-release (alpha) mode and
`.changeset/pre.json`'s `initialVersions` doesn't list pg-delta-next, so
`changeset status` planned a **minor** bump for it — the release workflow would
have consumed all 55 into a `chore: release` PR that bumps the unpublishable
package and writes a large CHANGELOG (`changeset publish` skips private packages,
so this was churn, not breakage).

**Fixed:** added `@supabase/pg-delta` to `.changeset/config.json` `ignore`.
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
- `load-sql-files.ts` non-role cluster DDL — already closed by the 25001
  fallback allowlist (see the shadow item above).
- `.changeset/pg-topo-total-ordered.md` — already bumped to minor.

**False positive:** `dbdev-roundtrip.test.ts` "missing dbdev fixture helper" —
`scripts/lib/bootstrap-dbdev-fixture.ts` is committed and tracked.

**Deferred P1 — owner-based policy exclusion is blind under `--scope database`
(dedicated follow-up PR):**

`cmdSchemaApply` projects both fact bases to management scope (`schema.ts:936-937`)
*before* `plan()` applies the policy. `projectManagementScope("database")` prunes
`role`/`membership` facts and every `owner` edge (they point at roles); the policy
owner predicate (`policy.ts:~397`) resolves owner from that edge (the extractor
never populates `payload.owner`), so the Supabase `{ owner: SUPABASE_SYSTEM_ROLES }`
exclusion (`supabase.ts:322`) can't match — a platform-role-owned object in a USER
schema (e.g. a `supabase_admin`-owned table in `public`) is treated as managed and
planned for DROP/ALTER. Data loss, in the default scope. (`schema export` already
composes the correct order — `resolveView` then project — so an export omits these
objects while a subsequent apply drops them.)

Deferred to its own PR because it changes core plan/apply/prove signatures and has
deliberate test-harness fallout. Recommended fix (Fable design):

- Add a trailing `scope: ManagementScope = "cluster"` param to `resolveView`
  (`policy.ts`) that applies `projectManagementScope` as the LAST step — owner
  edges are intact when the owner rule is evaluated, and
  `excludeFactsAndDescendants` already carries `referenceOnly` forward.
- Thread `scope` through `PlanOptions.scope` → `Plan.scope` (stamped like
  `capability`) → both `resolveView` calls in `change-set.ts` → the `apply`
  fingerprint gate (`apply.ts:145`) → both `resolveView` calls in `prove.ts:436`.
- In `schema.ts`, delete the two `projectManagementScope` calls (936-937) and the
  one in the fingerprint-gate re-extract closure (1000-1004); pass `scope` in
  `planOptions` instead. Export path unchanged.
- `"cluster"` (default) makes `projectManagementScope` identity, so the DB-to-DB
  plan path and the corpus are byte-identical (verify with a full corpus run).
- **Test-harness landmine:** `supabaseCluster()` connects as `supabase_admin` (a
  system role), so `phase2b-seed-shadow.test.ts` shadow objects become owner-
  excluded and strand requirements. Fix those tests to apply as a non-system
  login role (as `supabase-dsl-e2e.test.ts` already does) — do NOT weaken the fix.
- RED: a supabase-profile integration test where a `supabase_admin`-owned table in
  `public` must survive `schema apply --scope database --profile supabase` (today
  it is planned for DROP). Plus `resolve-view.test.ts` unit cases for the new param.

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
- `plan/internal.ts` `elideCascadeSubsumedPolicyDrops` — a policy's `TO <role>`
  refs live in the payload, not as edges, so dropping a table+role can elide the
  only `DROP POLICY` that releases the role (also on our own review list).
- `frontends/load-sql-files.ts` `CLUSTER_DDL_RULES` — the role/user/group regexes
  also match `CREATE/ALTER/DROP USER MAPPING` (a database-local FDW object), so
  database scope wrongly refuses/strips user mappings. Exclude `USER MAPPING`.
- `frontends/load-sql-files.ts` `maskLiteralsAndComments` — treats only doubled
  quotes as escapes, not `E'...\''` backslash escapes, so an `E`-string with a
  `;` can mis-split and trip the cluster-DDL / statement scanners. Make the mask
  E-string-aware (or reuse the sql-format scanner).
- `cli/commands/schema.ts` — a dir with `SET ROLE` / `SET SESSION AUTHORIZATION`
  / `SET search_path` leaves session state on the pooled client after the load
  (survives COMMIT), so validation/extraction can run under the wrong role. Reset
  session state after loading or isolate it.
- `plan/phases/action-emitter.ts` — default-ACL hygiene on replaced objects keys
  off the FINAL owner, but under `--restrict-to-applier` the recreate runs as the
  applier, so an applier-level ADP grant can survive without a matching REVOKE.
  Key the hygiene off the creator/applier role for recreated objects.
- Redaction safety: `extract/sensitive-options.ts` redacts `file_fdw`'s standard
  `filename` (not in the allowlist), producing a placeholder path that applies to
  a bogus file; `extract/publications.ts` keeps `enabled: true` for a redacted
  subscription, so a default redacted export can activate a worker against a
  placeholder conninfo. Both should preserve the non-credential value or refuse.

## PR #299 review triage (Codex) — engine-hardening backlog

Context: PR #299 promoted the clean-room engine to `@supabase/pg-delta` (the hard
switch). Codex re-reviews every commit and re-surfaces **pre-existing** engine gaps
— the switch itself only moved the package and added the build/CI/docs, so the
engine code is byte-identical to pre-switch. **None of these are switch
regressions**, and none were fixed in #299 (scope kept to the switch). They belong
to the engine-hardening track, alongside the extract-completeness fixes already
landed here (reloptions, aggregate/range/identity/subscription options: `f530082`,
`1fbdc69`, `528bc60`, `ed1bcdd`, `a638ecf`). Recorded with `comment_id`s for pickup.

### Batch A — planning/extract crashes on legitimate declarative input (highest value)

These make `plan` / `schema apply` / `export` throw on inputs a user can legitimately
author. The first two share the "nullable/`false` transition → `str()` throws → route
to **replace**" pattern already used for policy clause removal (`d2cdbf7`).

- **constraint validated→NOT VALID** — `src/plan/rules/constraints.ts:49` (comment
  `3537607442`). `validated` delta with `to === false` calls `str(to)` and aborts.
  Route through replace/drop-add (mirror policy `usingExpr`/`checkExpr` → `"replace"`).
- **foreign server VERSION removal** — `src/plan/rules/foreign.ts:70` (comment
  `3537607455`). `version` → `null` throws in the alter path (create already treats
  null as omitted). Handle the nullable transition or mark the attribute for replace.
- **enum rebuild with enum-array column** — `src/plan/rules/types.ts:230` (comment
  `3537607496`). For a `that_enum[]` column the rewrite renders scalar
  `TYPE <enum> USING col::text::<enum>` instead of the column's desired array type —
  plan fails / would scalarize the column. Use each dependent column fact's desired
  type/cast, not the enum `relName` unconditionally.
- **reference-only export member under a managed non-public schema** — ✅ **resolved**
  `src/frontends/export-sql-files.ts` (comment `3537607461`). Member seeded into
  the pristine baseline without its schema parent → `buildFactBase` missing-parent
  throw before any file renders. **Fix:** exclude extension members from the export
  baseline (via `extensionMemberReferenceOnly`) — they never need seeding
  (`CREATE EXTENSION` materializes them; the requirement guard's
  `memberExtensionPresent` satisfies any consumer), and the managed install schema
  is still exported so the result reloads. Regression:
  `tests/export-extension-member-parent.test.ts`.
- **user mapping on a filtered extension-owned server** — `src/extract/foreign.ts:91`
  (comment `3537607477`). Ext-owned servers are anti-joined out, but `pg_user_mapping`
  rows still emit and parent to an absent `server` fact → missing-parent throw. Filter
  the mappings consistently, or keep the server as a reference-only parent.

### Batch B — rendering / access / library correctness

- **zero-argument aggregate metadata** — `src/plan/render.ts:59` (comment
  `3537607470`). `COMMENT ON AGGREGATE "s"."agg"()` (and the reused SECURITY LABEL
  target) must be `(*)` for zero-arg aggregates; a from-empty plan creates the
  aggregate then fails on the metadata statement. Use the signature renderer that
  emits `*` for empty args.
- **role security labels touch `pg_authid`** — `src/extract/security-labels.ts:195`
  (comment `3537607465`). If any security label exists and extraction runs as a
  non-superuser, the role-label query reads `pg_authid` (superuser-only) and fails —
  even when the label is on a table. Join through `pg_roles`.
- **default apply gate ignores plan redaction mode** — `src/apply/apply.ts:144`
  (comment `3537607487`). A library caller applying an unredacted plan
  (`redactSecrets: false`) without the CLI wrapper still re-extracts redacted, so the
  fingerprint gate compares cleartext to placeholders and rejects an unchanged target.
  When no custom `reextract` is supplied, pass `thePlan.redactSecrets ?? true` to
  `extract` (mirror in `prove.ts` re-extraction). Ties to the display-vs-apply
  redaction follow-up (comment `3428269873`).

### Earlier open extract-completeness batch (same track)

From the same review stream; jgoux fixed several siblings, these remain for pickup —
role membership SET/INHERIT options (`3530186654`), database-scoped role GUCs
`setdatabase<>0` (`3530186665`), unlogged sequences `relpersistence` (`3530186678`),
matview populated state `WITH [NO] DATA` (`3530186683`), user-defined base types
(`3530186693`), user-rule dependency resolution to rule facts (`3530186701`), custom
identity sequence names (`3530186709`), foreign-column FDW options `attfdwoptions`
(`3530186714`), PG18 virtual generated columns (`3530186719`), publication
`publish_generated_columns` (`3530186730`), role connection limits `rolconnlimit`
(`3530186736`), multiple-inheritance parents (`3536715681`), foreign-table partition
attachments (`3536715689`), non-relocatable extension `SET SCHEMA` (`3536715698`),
enum metadata restore after value-set rebuild (`3536715704`), partial default-privilege
reset before grants (`3536715708`), window-function dependency resolution `prokind='w'`
(`3536715714`), publication-member rebuild on table replace (`3536715717`).

### Wave 2 (re-review of commit `ada0ab5`) — more of the same track

Planning / export / apply fidelity:

- **typed-table `OF` relationships** — `src/plan/rules/tables.ts:64` (comment
  `3537805071`). A `CREATE TABLE ... OF composite_type` renders as an ordinary
  `CREATE TABLE (...)`; the only catalog difference is a depends-edge (which emits no
  DDL), so typedness-only changes no-op and from-empty plans recreate typed tables as
  ordinary ones. Needs a `pg_class.reloftype` marker on the payload to drive replace.
- **by-object export FK atomicity** — `src/frontends/export-sql-files.ts:388` (comment
  `3537805092`). By-object export appends every table action to one file, but
  `loadSqlFiles` applies each file atomically; for mutually-dependent FKs the plan is
  correctly ordered but regrouped so each file's FK references the other's not-yet-
  committed table → both roll back. Keep FK alters in dependency-order runs / separate
  files to preserve the by-object fidelity contract.
- **policy `TO`-role release before DROP ROLE** — `src/plan/rules/policies.ts:56`
  (comment `3537805111`). When a policy's `TO` list drops a role in the same plan, the
  `ALTER POLICY ... TO ...` neither releases nor consumes the old role; policy role
  refs are shared deps (not `pg_depend` edges), so the graph may run `DROP ROLE` first
  and fail. (Same family as the `elideCascadeSubsumedPolicyDrops` item above.)

Extract-completeness / coverage (invisible drift):

- **ICU collation rules** — `src/extract/types.ts:298` (comment `3537805075`).
  `pg_collation.collicurules` isn't hashed, so a `RULES`-only difference compares equal
  and from-empty emits `CREATE COLLATION` without the rules.
- **user-defined conversions unmodeled** — `src/extract/unmodeled.ts:62` (comment
  `3537805081`). The completeness probe omits `pg_conversion`, so a `CREATE CONVERSION`
  yields neither a fact nor an `unmodeled_kind` diagnostic — strict coverage silently
  ignores it.
- **extension-member columns dropped from the reference view** —
  `src/extract/relations.ts:138` (comment `3537805086`). The anti-join skips column
  facts of an ext-owned table even when the table is kept as a member, so column
  satellites (comment/seclabel) and column-level edges dangle. Keep columns as
  reference-only descendants.
- **column-level privileges** — `src/extract/relations.ts:129` (comment `3537805098`).
  `pg_attribute.attacl` (`GRANT SELECT (col)`) isn't emitted as an `acl` satellite, so
  column-grant-only diffs are invisible and from-empty exports drop them.
- **role comments in cluster scope** — `src/extract/roles.ts:32` (comment `3537805102`).
  Cluster-scope role facts never emit a comment satellite, so `COMMENT ON ROLE` drift is
  invisible and from-empty cluster exports omit it (the renderer already supports it).

### Wave 3 (re-reviews of `671a799` / `5e26a52`) — more extract-completeness / replace-cascade

Only the findings NOT already listed above (Codex re-issues the earlier ones — role
membership options, db-scoped GUCs, unlogged sequences, matview populated, range
CANONICAL, foreign-column `attfdwoptions` — with fresh comment_ids each pass).

Replace / apply cascade:

- **FDW server children rebuild on replace** — ✅ **resolved** by `da2d75c1`.
  Replacement emission recursively drops children across non-cascading server
  boundaries, recreates surviving descendants after the server, and is pinned in
  both directions by `foreign-data-wrapper-operations--replace-server-with-children`.
  The original finding was comment `3537910549`.

Extract-completeness (invisible drift / wrong from-empty replay):

- **composite attribute order** — `src/extract/types.ts` (comment `3537910546`). ✅ **partially
  resolved** (Unit A, this branch): `attnum` is now carried as non-semantic `_position` and the
  from-empty composite `CREATE TYPE` renders in declared order, so reconstruction no longer
  changes row layout. STILL OPEN: the order-only-diff-*detection* half — a field-order-only
  difference still compares equal (position is `_`-excluded from the hash by design), so a live
  reorder is not detected as a delta. Making position semantic needs type-rebuild machinery for
  order-only changes and would invalidate every snapshot/baseline — deferred.
- **comments on constraint-backed indexes** — `src/extract/relations.ts:272` (comment
  `3537910554`). The index anti-join drops the index fact for a PK/unique/exclusion
  constraint, and the constraint extractor reads only `pg_constraint` comments, so a
  `COMMENT ON INDEX` on that index is lost.
- **table tablespaces** — `src/extract/relations.ts:82` (comment `3537910560`).
  `pg_class.reltablespace` isn't hashed and no create/alter renders `TABLESPACE`;
  tablespace-only diffs no-op and from-empty replay uses the default tablespace.
- **table access methods** — `src/extract/relations.ts:36` (comment `3537910571`).
  `pg_class.relam` (`CREATE TABLE … USING …`) isn't recorded; AM-only diffs compare
  equal and from-empty replay uses the default table AM.
- **column storage metadata** — `src/extract/relations.ts:100` (comment `3537910575`).
  `SET STORAGE` / `SET COMPRESSION` / `SET STATISTICS` (on `pg_attribute`) aren't
  extracted or rendered; those-only diffs are invisible and from-empty replay uses
  defaults.
- **role `VALID UNTIL`** — `src/extract/roles.ts:30` (comment `3537910580`). The
  password-expiry attribute isn't on the role payload; a login role differing only by
  expiry compares equal and from-empty cluster export drops it.
- **subscription `failover`** — `src/extract/publications.ts:135` (comment `3537910587`).
  The version-gated subscription option list stops at `run_as_owner`/`origin`; a
  `failover`-only difference hashes identically and from-empty replay omits it.

### Wave 4 (re-review of `bd68f7b`) — apply-ordering / access / shadow

New findings only (multiple-inheritance parents `3538433909` and window-function deps
`3538433920` are re-issues of `3536715681` / `3536715714` above).

Apply ordering / cascade (plan can fail at apply):

- **release old sequence owner before dropping it** — `src/plan/rules/sequences.ts:117`
  (comment `3538433876`). Retargeting an `OWNED BY` sequence to a new column while the
  old column/table is dropped in the same plan: the alter consumes only the new owner;
  the extractor drops the sequence→old-column auto-dep and drops sort before alters, so
  the old table (and its owned sequence) can be dropped first → the later
  `ALTER SEQUENCE … OWNED BY` fails. Order via the `from` owned-by value.
- **order in-place alters after new dependencies** — `src/plan/internal.ts:184` (comment
  `3538433892`). An ALTER that makes a surviving fact depend on a newly-created object
  (column → new enum/domain, default → new function) only consumes the existing fact and
  isn't in `produces`, so the desired dependency edge is never walked → the ALTER can
  sort before the CREATE and fail. Walk desired edges for altered subjects (or make the
  alter consume the new target).
- **move extensions before dropping their old schema** — `src/plan/rules/schemas.ts:81`
  (comment `3538433899`). A relocatable extension moving `old`→`new` while `old` is
  dropped: the alter consumes only `new` and never releases `old`, so `DROP SCHEMA old`
  can run while members are still there and fail. Order the move via the `from` schema.

Access / shadow correctness:

- **subscription conninfo read as non-superuser** — `src/extract/publications.ts:139`
  (comment `3538433886`). The unconditional `subconninfo` select fails for normal users
  (PostgreSQL revokes that column) before redaction can help — a non-superuser diff
  aborts in subscription extraction. Guard by privilege; diagnostic/placeholder instead.
- **shadow emptiness check misses non-relation objects** —
  `src/frontends/load-sql-files.ts:459` (comment `3538433916`). The guard checks only
  `pg_class`, so a shadow pre-loaded with enums/domains/routines/collations/extensions/
  default-privileges is treated as empty; the load then extracts that pre-existing state
  as if it were declared, contaminating the desired fact base. Cover all managed catalogs.

## Supabase roundtrip hardening (non-superuser Cloud fidelity) — this branch

Driven by the Supabase roundtrip acceptance harness (`scripts/roundtrip-supabase.ts`)
applying as the production-faithful role a real Cloud project hands users: a NON-superuser
`postgres` that is a member of `supabase_privileged_role` (not the `supabase_admin` the test
harness previously stood in with — see `tests/containers.ts`). The old SUPERUSER shim masked
a series of real non-superuser failures, each fixed RED-first on this branch:

- **composite attribute order** — Unit A (see above; ✅ render/export, detection deferred).
- **body validation blocked user applies on platform code** — ✅ Unit B: routine-body
  validation failures in seeded (assumed-schema) schemas are now named warnings, not hard
  errors; user-schema failures still block and now name the routine; the CLI prints the
  per-routine `ShadowLoadError.details`.
- **body validation of non-sql/plpgsql routines** — ✅ Unit G
  (`src/frontends/load-sql-files.ts`): the pass is scoped to `lanname IN ('sql','plpgsql')`
  (the only bodies `check_function_bodies` validates). `LANGUAGE internal` range-support
  functions auto-generated by `CREATE TYPE … AS RANGE` are non-superuser-uncreatable and
  have no checkable body.
- **co-located seed not replayable by non-superuser** — ✅ Unit C
  (`src/frontends/seed-assumed-schemas.ts`): the seed omits `defaultPrivilege` facts and
  skips routines whose `pg_proc.proconfig` sets a superuser-only GUC (carried structurally
  as non-semantic `_configGucs`; NO SQL-text editing — see the doctrine in
  `.github/agents/pg-toolbelt.md`) plus their in-seed dependents.
- **system-role ADP exported as user state** — ✅ Unit E (`src/policy/supabase.ts` Rule 6b):
  `defaultPrivilege` facts whose FOR-role (`id.role`) is a system role are excluded
  (platform-managed); grantee-side ADP (the user-owned API-role default) is kept.
- **inline constraints folded over deferred columns** — ✅ Unit D
  (`src/plan/internal.ts` `compactColumnFolds`): a table constraint is no longer folded
  inline when a same-table column it references was deferred to a later `ADD COLUMN`
  (domain-typed / generated columns) — it renders as a standalone `ADD CONSTRAINT`.
- **owner-based policy exclusion defeated under database scope** — ✅ Unit H
  (`src/plan/phases/change-set.ts` + `plan.ts`/`apply.ts`/`prove.ts`): the managed view is
  now `projectManagementScope(resolveView(raw, …), scope)` in one place, so owner edges
  survive policy resolution and a policy owner-exclusion rule (Supabase Rule 6) correctly
  excludes system-role-owned platform objects (event triggers, etc.) instead of planning a
  DROP the applier cannot execute. This had been silently DROPping platform event triggers
  under the SUPERUSER shim.

### Still open

- **P2 — local-`supabase start` vs Cloud baseline drift.** After all fixes, the roundtrip's
  ONLY residual diff is `schemas/public/default_privileges.sql`: the local base-init fixture
  (`tests/fixtures/supabase-base-init/*.sql`, from `supabase start`) carries
  `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" … REVOKE ALL … FROM "postgres"` entries the
  Cloud source project does not. No loader/policy/engine change fixes this — it is a
  baseline-DATA divergence between local and Cloud provisioning. This is the concrete case
  for the versioned-baseline-sidecar work (per-stack-fingerprint baselines derived from real
  Cloud state rather than a local-fixture capture). See
  [ephemeral-shadow-design.md § "Adjacent proposal"](ephemeral-shadow-design.md#adjacent-proposal-docker-urls-and-a-supabase-shadow-image)
  for why generating that baseline from a `docker://supabase/<major>` image (+ per-service
  setup scripts) was rejected, and the recommended derive-from-the-target sequencing.
- **P3 — bootstrapped explicit `--shadow` for the supabase profile.** A user-bootstrapped
  (base-init'd) explicit `--shadow` currently trips the loader emptiness guard ("shadow
  database is not empty"). Deferred deliberately: a bootstrapped shadow's platform surface
  matches the installer era, not the target, so managed-scope divergences would surface as
  phantom migrations — strictly more dangerous than the target-derived co-located seed, and
  its one advantage (no reconstruction) is moot now that the seed is non-superuser-replayable
  (Unit C). Revisit only alongside the baseline-sidecar work, which would make
  bootstrap-vs-target drift detectable.

## PR #368 review triage (Codex) — `schema export` out-dir hardening (deferred by design)

PR #368 (case-twin export path collisions, issue #365) went through ~12 rounds
of automated Codex review. The core fix and its load-bearing consequences were
kept; a large writer-hardening layer that grew out of the loop was **removed
before merge, deliberately**. This section is the record — if an automated
review re-flags one of these, reply with a link here instead of re-fixing.

**Kept (in the PR):** case-collision folding (canonical member spelling per
segment; twins share one file), file-grain cycle handling (two-grain
`cyclicForeignKeys` + `mergeDependencyCycles` — without these, merged files
provably wedge the raw loader), dot-encoding in `seg()` (`Foo.fk` →
`Foo%2Efk.sql`; reserves the `.sql`/`.fk.sql` suffix namespace and fixes a
pre-existing bug where a table named `*.fk` received the FK-split header),
240-byte segment / 255-byte ordered-name clamps (ENAMETOOLONG for dot-rich
group names), and `resolve(outRoot)` in `writeExportFiles` (pre-existing
relative-`--out-dir` prune misbehavior).

**Removed (the deferred hardening layer).** The writer's contract is: **the
export owns every destination it writes**; only *out-of-set* `.sql` files get
the unmanaged refusal (`--prune-unmanaged` to override). This matches
pre-#368 behavior and tools like `tar -x` into a user-chosen directory. The
review loop demanded stronger guarantees for destinations whose *spelling* the
PR introduced (fold-composed paths, dot-encoded names, clamped names), and the
resulting subsystem (~350 lines) was cut because it hardened only the new
spellings to a standard the rest of the writer has never met:

- **In-set overwrite protection** — refusing a pre-existing, not-manifest-owned
  file at a destination the export is about to write (per-file
  `needsOwnershipCheck` marks, lstat probes, guard-before-prune ordering).
- **Symlink/entry attacks inside `--out-dir`** — non-following existence
  probes, top-down ancestor scans rejecting symlinked/non-directory ancestors,
  link-only deletion under `--prune-unmanaged`. Threat model: someone plants
  entries inside your own export directory; if an attacker can do that, the
  pre-existing writer was equally exposed at every old spelling.
- **Case-alias ownership on APFS/NTFS upgrades** — dev+ino identity so a
  manifest path differing only by case counts as owned. Without it, the first
  re-export over a pre-#368 corrupted directory may need `--prune-unmanaged`
  once (fail-closed, self-healing).

If out-dir hardening is ever wanted, do it as a deliberate, whole-writer design
(uniform policy for ALL destinations, not per-spelling marks) — the removed
implementation and its tests live in the PR #368 history up to commit
`176c843` for reference. Known accepted consequences until then: a
hand-authored file placed at exactly a managed object's export path is
overwritten without refusal (as before #368), and exports into directories
containing symlinks follow them (as before #368).

**Meta-lesson (also in AGENTS.md):** cap automated-review iterations. Each
round's finding was locally valid, but the sum re-litigated the writer's
contract one exotic corner at a time. When a bot's findings drift from the
issue's scope — or start finding bugs only in the previous round's fix — stop
patching, decide the contract explicitly, and record it here.
