# pg-delta-next — known pitfalls & follow-ups

Captured from the code review of PR #315 (orderless declarative apply, grouped
export, formatting, redaction). These are **known, accepted** at merge time —
recorded here so they aren't rediscovered. Nothing below blocks the stacked
`feat/pg-delta-next` line from landing, but each should be picked up before the
engine is promoted past preview.

Severity legend: **P1** correctness/safety, **P2** contract/coverage gap,
**P3** cleanup/maintainability.

> **Cutover triage (2026-08):** see the "Old-engine differential review" section
> below for the triage of the differential review against the legacy engine.
> This ledger was reconciled against the code on 2026-08-04 — a number of
> entries below had already been fixed (each now carries a ✅ with its commit).

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
— ✅ resolved (Unit H; see "Supabase roundtrip hardening" below — the managed
view is now `projectManagementScope(resolveView(raw, …), scope)` in one place):**

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

- ✅ **resolved** — `extract/routines.ts` window functions: `prokind 'w'` is now
  in the extraction query and the dependency resolver
  (`src/extract/routines.ts:37`, `src/extract/dependencies.ts:104`). Was: the
  resolver used `('f','p','a')` only.
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
- ✅ **resolved** — `frontends/load-sql-files.ts` `CLUSTER_DDL_RULES` user
  mappings: the role regexes now carry a `user(?!\s+mapping)` negative lookahead
  (`load-sql-files.ts:373-395`), so `CREATE/ALTER/DROP USER MAPPING` is no
  longer refused/stripped under database scope.
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

- **constraint validated→NOT VALID** — ✅ **resolved** (`e1f46694`): routed to
  replace (`src/plan/rules/constraints.ts:63-82`); corpus
  `domain-operations--not-valid-constraint`. Was: `validated` delta with
  `to === false` called `str(to)` and aborted (comment `3537607442`).
- **foreign server VERSION removal** — ✅ **resolved**:
  `replaceWhen: (_from, to) => to == null` (`src/plan/rules/foreign.ts:73`);
  corpus `foreign-data-wrapper-operations--remove-server-version`. Was:
  `version` → `null` threw in the alter path (comment `3537607455`).
- **enum rebuild with enum-array column** — ✅ **resolved** (`c410cd19`): the
  rewrite reads each dependent column fact's desired type and renders the array
  cast (`src/plan/rules/types.ts:389-398`); corpus
  `type-ops--enum-replace-array-column`. Was: scalar `TYPE <enum>` rendered
  unconditionally (comment `3537607496`).
- **reference-only export member under a managed non-public schema** — ✅ **resolved**
  `src/frontends/export-sql-files.ts` (comment `3537607461`). Member seeded into
  the pristine baseline without its schema parent → `buildFactBase` missing-parent
  throw before any file renders. **Fix:** exclude extension members from the export
  baseline (via `extensionMemberReferenceOnly`) — they never need seeding
  (`CREATE EXTENSION` materializes them; the requirement guard's
  `memberExtensionPresent` satisfies any consumer), and the managed install schema
  is still exported so the result reloads. Regression:
  `tests/export-extension-member-parent.test.ts`.
- **user mapping on a filtered extension-owned server** — ✅ **resolved**
  (`3aa068c0`): mappings share the server's `notExtensionMember` anti-join
  (`src/extract/foreign.ts`); regression
  `tests/foreign-extension-user-mapping.test.ts`. Was: orphan mappings parented
  to an absent server fact → missing-parent throw (comment `3537607477`).

### Batch B — rendering / access / library correctness

- **zero-argument aggregate metadata** — ✅ **resolved** (`9c9c81d9`): renders
  `(*)` for empty args (`src/plan/render.ts:68-70`); corpus
  `aggregate-operations--comment-zero-arg`. Was: `()` rendered, failing the
  metadata statement (comment `3537607470`).
- **role security labels touch `pg_authid`** — ✅ **resolved** (`56729c76`):
  joins through `pg_roles` (`src/extract/security-labels.ts:230`); regression
  `tests/nonsuperuser-extraction-gaps.test.ts`. Was: superuser-only `pg_authid`
  read failed non-superuser extraction (comment `3537607465`).
- **default apply gate ignores plan redaction mode** — ✅ **resolved**
  (`56729c76`): the default re-extract passes
  `redactSecrets: thePlan.redactSecrets ?? true` (`src/apply/apply.ts:235`).
  Was: an unredacted plan re-extracted redacted, so the fingerprint gate
  rejected an unchanged target (comment `3537607487`; display-vs-apply
  redaction follow-up `3428269873` still open).

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
reset before grants (`3536715708`), ~~window-function dependency resolution
`prokind='w'` (`3536715714`)~~ ✅ resolved (`routines.ts:37`,
`dependencies.ts:104`), publication-member rebuild on table replace (`3536715717`).

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
- **policy `TO`-role release before DROP ROLE** — ✅ **resolved**: the alter
  releases every role in `fromRoles` not present in `toRoles`
  (`src/plan/rules/policies.ts:63-65`). Was: `ALTER POLICY … TO …` neither
  released nor consumed the old role (comment `3537805111`). The sibling
  `elideCascadeSubsumedPolicyDrops` payload-roles gap is still open.

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
- **subscription `password_required`** — `src/extract/publications.ts` (PR #388
  Codex re-review; the only NEW fragment in that batch). `subpasswordrequired`
  (PG16+) isn't extracted, so `password_required = false` compares equal to the
  default and a recreate re-enables it. Superuser-only DDL that interacts with
  the `subconninfo` secret-redaction path — handle with the `failover` entry
  above. Tracked in Linear CLI-2134.

### Wave 4 (re-review of `bd68f7b`) — apply-ordering / access / shadow

New findings only (multiple-inheritance parents `3538433909` and window-function deps
`3538433920` are re-issues of `3536715681` / `3536715714` above).

Apply ordering / cascade (plan can fail at apply):

- **release old sequence owner before dropping it** — ✅ **resolved**:
  `sequenceOwnedBySpecs` takes `releaseOld` and populates `releases`
  (`src/plan/rules/sequences.ts:104`, `helpers.ts:476-512`). Was: the alter
  consumed only the new owner, so the old table could drop first (comment
  `3538433876`).
- **order in-place alters after new dependencies** — ✅ **resolved**: column
  type alters consume the new target via `dependencyConsumes(view, fact.id)`
  (`src/plan/rules/tables.ts:256`). Was: the desired dependency edge was never
  walked, so the ALTER could sort before the CREATE (comment `3538433892`).
- **move extensions before dropping their old schema** — ✅ **resolved**: the
  move declares `releases: [{ kind: "schema", name: str(from) }]`
  (`src/plan/rules/schemas.ts:107`), ordering it before `DROP SCHEMA old`. Was:
  only `new` was consumed (comment `3538433899`).

Access / shadow correctness:

- **subscription conninfo read as non-superuser** — ✅ **resolved**
  (`56729c76`): the query includes `subconninfo` only after a
  `has_column_privilege` probe (`src/extract/publications.ts:145-152`);
  regression `tests/nonsuperuser-extraction-gaps.test.ts`. Was: the
  unconditional select aborted non-superuser diffs (comment `3538433886`).
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

## Old-engine differential review (2026-08) — cutover triage

A differential review of the clean-room engine against the last legacy release,
triaged for the cutover decision (promoting `@supabase/pg-delta` past
preview/alpha). This section is the durable record — if a finding below is
re-raised in a later review, reply with a link here.

| # | Finding | State | vs. previous engine | Disposition |
|---|---|---|---|---|
| P1a | `DROP DEFAULT` emitted on identity/generated column type change | reproduced | **regression** — old engine guarded it | **blocker** → ✅ [#379](https://github.com/supabase/pg-toolbelt/pull/379) |
| P1b | `SET MAXVALUE` ordered before `TYPE` widening on identity columns | reproduced, new | regression class (old engine had no identity-bounds emitter) | **blocker** → ✅ [#379](https://github.com/supabase/pg-toolbelt/pull/379) |
| P2a | `relam` / `reltablespace` invisible to diff | real, tracked | shared pre-existing gap | subsumed by the Wave 3 entries above |
| P2b | `pg_parameter_acl` (PG15+) silently dropped | real, untracked | shared pre-existing gap | probe + docs → ✅ [#380](https://github.com/supabase/pg-toolbelt/pull/380) |
| P2c | identity sequence grants | not a bug | identical behavior in old engine | **closed won't-fix** |
| P3 | no outside-observer verification gate | absent | never existed in either engine | post-cutover — tracked in [backlog.md](backlog.md) § Validation |

Notes:

- **P1a/P1b (#379):** one corpus scenario
  (`identity-operations--widen-identity-column`) turned both RED; the fix gates
  the `DROP DEFAULT` sandwich on the SOURCE-side column being neither identity
  nor generated, and folds the identity bounds specs after the `TYPE` statement
  when both deltas land on one column fact. A **third defect** surfaced during
  RED: the `USING` cast is illegal on generated columns, and those do NOT route
  through replace (the generation expression renders identically across the
  type change, so only a `type` delta exists) — `USING` is now omitted for
  source-generated columns, `rewriteRisk` retained.
- **P2b (#380):** `pg_parameter_acl` was neither a fact nor in the
  `unmodeled_kind` probe list — silently invisible, violating the completeness
  module's own contract. Now a probe (with `minVersion` version gating);
  modeling the grant as a fact remains add-when-needed.
- **P2c rationale:** grant handling on identity sequences is byte-identical to
  the legacy engine's behavior; the review confirmed there is no defect to fix.
- **Still open (discovered during #379):** a desired identity bound pinned
  exactly at the source type's max (e.g. `bigint … (MAXVALUE 2147483647)` from
  an `integer` identity) produces **no** `identity` delta, yet PostgreSQL
  re-derives the bound on retype — invisible drift. Needs a synthesized bounds
  delta at extract/diff time when the column type changes.
- **Cutover bar:** merge #379/#380, then the standing validation gates in
  [backlog.md](backlog.md) (generative soak at quota, real-world shakedown,
  scope statement).

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

## PR #379 review triage (Codex) — identity columns through a type change

PR #379 made identity/generated columns survive a `type` change. Two Codex P1
findings were fixed in the PR (the `DROP DEFAULT` gate now reads the *desired*
identity side; identity bounds move *before* the `TYPE` when narrowing — both
covered by corpus scenarios `identity-operations--add-identity-with-type-change`
and `identity-operations--widen-identity-explicit-bounds`). Two adjacent corners
are **deliberately deferred** — they are pre-existing ordering gaps that the PR
merely brings within reach, not defects in what it adds. If an automated review
re-flags one, link here instead of re-fixing.

- **Adding identity to a NULLABLE plain column fails.** Identity columns are
  implicitly `NOT NULL`, so the plan carries both an `identity` add and a
  `notNull` set. The differ emits a fact's attributes alphabetically
  (`identity` < `notNull`), so `ADD … AS IDENTITY` runs first and PostgreSQL
  rejects it on a nullable column. This is the same emission-order gap as the
  fixed `type` case, but fixing it needs the `notNull` rule to know an identity
  add is pending (or an ordering edge between two attribute deltas on one fact)
  — a broader change than this PR's scope. Workaround: declare the source column
  `NOT NULL`. The new corpus scenario does exactly that, deliberately.

- **Plain column → identity with inline bounds exceeding the CURRENT column
  type fails.** `ADD … AS IDENTITY (MAXVALUE 5000000000)` on an `integer` column
  that is *also* widening to `bigint` in the same plan is rejected at the ADD:
  inline identity options are validated against the not-yet-retyped column, and
  the `identity` delta orders before the `type` delta. The narrowing fix does
  not cover this because there are no source bounds to move — the bounds arrive
  inline with the ADD. A fix would have to split the ADD into a bare
  `ADD … AS IDENTITY` plus a post-retype chained `SET`, i.e. teach
  `identity.alter` about a concurrent widening; deferred until a real schema
  needs it.

## PR #383 review triage (Codex) — `partitionOf` policy predicate

Codex reviewed #383 while the PR was still mis-based against `main`, so the
diff it saw was the entire delta-next rewrite, not the PR's six files. All
four findings target pre-existing engine code the PR never touches — none is
a defect in what the PR adds — so per the automated-review scope rule they
are recorded here instead of fixed there. If a re-review re-flags one, link
to this section.

- **P1 — `CONCURRENTLY` splice in `src/plan/rules/indexes.ts` "violates the
  no-regex-transform rule".** Pre-existing behavior of the opt-in
  `concurrentIndexes` serialize param. The splice is an anchored prefix
  rewrite inserting an execution modifier that `pg_get_indexdef` can never
  emit (CONCURRENTLY is an execution choice, not catalog state) — it never
  changes what the index *is*, only how it is built, and partitioned parents
  are already exempted. Arguably still a doctrinal wart: a cleaner shape
  would render the statement from structured state. Revisit only if the
  splice ever misfires on a real `def`; not a #383 concern.

- **P2 — `pg_publication_rel` dependencies resolve to the parent publication,
  not the `publicationRel` member (`src/extract/dependencies.ts`, `pubrel`
  CTE).** Plausible: a PG15+ member column list / row filter depending on a
  function or type that is replaced would not rebuild the member, and a
  planned function drop could fail at apply. Pre-existing extraction
  behavior; needs a repro (corpus scenario with a row-filtered publication
  member whose function is replaced) before a fix. Same family as the
  member-grain work in #370.

- **P1 — `databaseScratch` emptiness guard counts only `pg_class` rows
  (`src/frontends/load-sql-files.ts`).** Plausible: a scratch shadow
  pre-populated with only non-relation objects (enum, function, empty user
  schema, …) passes the guard and contaminates the loaded desired state. The
  guard should sweep every managed catalog outside the allowed seeded
  schemas. Pre-existing frontend hardening; needs its own RED test.

- **P2 — composite retype guard rejects a plan that adds the FIRST column of
  the retyped composite (`src/plan/rules/types.ts`).** Plausible
  over-rejection: the guard reads desired-side columns, but PostgreSQL only
  forbids `ALTER TYPE … ALTER ATTRIBUTE` while a column already exists —
  distinguishing source-side users from newly-added columns (and ordering
  those creates after the retype) would admit a valid migration. Pre-existing
  planner conservatism: it fails loud, never corrupts. Fix when a real schema
  hits it.

## PR #388 review triage (Codex) — plan compaction (constraint folds, grant merges)

Codex reviewed #388 while the PR was briefly based against `main` (before the
retarget to `feat/pg-delta-next`), so the diff it saw was the entire delta-next
engine, not the PR's compaction/formatter files. All seven findings target
`src/extract/**` / `load-sql-files.ts` — code the PR never touches — so per the
automated-review scope rule they are recorded, not fixed there. Six of seven are
re-issues of entries already in this ledger (ICU collation rules `3537805075`,
membership SET/INHERIT `3530186654`, `rolconnlimit` `3530186736`, matview
populated state `3530186683`, the `databaseScratch` emptiness guard, range
CANONICAL, subscription `failover` `3537910587`); the ONE new fragment —
subscription `password_required` — is recorded in the extract-completeness list
above. Consolidated for the fidelity-hardening milestone as **Linear CLI-2134**.

## PR #390 review triage (Codex) — jit-disable privilege guard, hash-memo budget

Two Codex findings on PR #390 (extraction-time perf work) were fixed in the PR:
the `SET LOCAL jit = off` pin now degrades gracefully instead of aborting
extraction when the connecting role lacks SET privilege on `jit`
(`src/extract/extract.ts`, mirrored in `src/frontends/load-sql-files.ts`), and
`src/core/hash.ts`'s canonical-string memo no longer retains an individually
oversized key past its advertised total-length budget. One further finding is
**deferred, won't-fix in #390**:

- **WeakMap identity cache can serve a stale digest if a payload object is
  mutated after hashing (`src/core/hash.ts`, `payloadHashes`).** Payload
  mutation after hashing is outside the supported contract — the invariant is
  documented at the `payloadHashes` declaration ("a payload object is never
  mutated after it has first been hashed... every transform that changes one
  returns a NEW object"). Every internal site was audited: the one rewriting
  site (`plan/identity-normalize.ts`'s `normalizePayload`) allocates fresh
  objects rather than mutating in place. And the proof loop (`src/proof/
  prove.ts`) re-extracts applied state with FRESH objects on every run, so a
  stale-hash-induced wrong plan would fail the proof rather than pass
  silently. Revisit only if the public API is ever changed to document
  payload mutability as supported.

## PR #391 review triage — pg_cron username elision

- **Deferred — export-resolved default owner is not threaded into pg_cron
  rendering.** `buildSchemaExport` resolves a per-export owner (`defaultOwner`
  option → profile default → `datdba`; `src/frontends/schema-export.ts:40-111`)
  that can diverge from the handler's configured `defaultJobOwner`; a cron job
  owned by that resolved role still renders an explicit username and needs a
  superuser executor. Deferred because it requires threading export-time
  context into intent rendering (rejected as disproportionate in this PR's
  design); the capture-time `intent-privileged` warning already fires for
  exactly this divergence, so the failure is pre-announced. Revisit if a real
  profile hits it.


## PR #401 review triage (Codex) — wrappers-FDW suppression

Two findings on the CLI-1470 fix. P1 was fixed in the PR; P2 is recorded here.

- **Fixed (P1) — bare `DROP EXTENSION "wrappers"` when the desired state
  omits the dashboard-installed extension.** With wrappers-provisioned FDWs
  projected out (Rule 6c), keeping the extension itself managed planned a
  bare drop that PostgreSQL rejects (the suppressed FDW still depends on the
  extension's handler/validator functions). Fix: `wrappers` joined
  `SUPABASE_SYSTEM_EXTENSIONS` — it is dashboard-installed, never declared in
  user schema files, so the same platform judgment as `pg_graphql` (#5555)
  applies; the extension and its FDWs are now assumed-present together.

- **Deferred (P2) — `isNamedObjectPredicate()` / `containsWildcardMatcher()`
  do not inspect `edgeTo`, so a concrete `edgeTo: { name: "wrappers" }`
  selector in a CUSTOM policy without explicit `audit` metadata defaults to
  the `suspicious` projection-audit classification.** Deferred by design
  judgment, not oversight: no `edgeTo` form was ever classified as a
  named-object selector (including a concrete `schema`), and the default is
  arguably correct — an edge-based rule pins a concrete *provenance*, not
  concrete named objects; it still excludes an unbounded class of dependents
  (every FDW depending on `wrappers`), which is exactly what the audit's
  "suspicious" bucket exists to surface. `suspicious` is a review flag, not
  a behavior change, and explicit `audit` metadata (which the Supabase rule
  supplies) is the intended escape hatch for a policy author who has made
  the judgment deliberately. Revisit only if a real custom-policy consumer
  hits audit friction with a pinned edgeTo selector.

- **Deferred (round 2, P2) — declarative `CREATE EXTENSION wrappers` is not
  emitted for a target that lacks it.** True, and identical to the other four
  `SUPABASE_SYSTEM_EXTENSIONS` entries: the platform list makes an extension
  invisible in BOTH directions, so a user-declared platform extension is
  never created either. The finding's failure mode ("retained user objects
  that depend on its members fail during apply") has no instance under this
  policy: the only objects that depend on wrappers members are FDWs built
  from its handlers, which Rule 6c deliberately removes from the managed
  surface (their servers / foreign tables / user mappings cascade out). The
  fair kernel is that `wrappers` is CONDITIONALLY present (installed when a
  dashboard integration is enabled) while the other entries are
  image-provisioned — that conditionality is exactly the known name-list
  limitation the policy header documents; the committed Supabase baseline
  (docs/roadmap/backlog.md) is the mechanism that can distinguish
  "present on this target" from "assumed by name" and is the revisit path.

- **Deferred (round 3, P1) — a kept user object over a suppressed wrapper
  prerequisite plans SQL that fails at apply.** Tracked as CLI-2178 (pg-delta
  1.0.0 stable release project). Reproduced (2026-08-11): a
  `dsl_owner` view over a foreign table on a suppressed wrappers FDW plans
  `CREATE VIEW public.paying_users AS SELECT … FROM stripe.customers` with no
  prerequisite and no plan-time diagnostic — `excludeFactsAndDescendants`
  prunes by parent descent only, and the view's `depends` edge drops with its
  endpoint, so apply fails on any target lacking the dashboard integration.
  Valid, but the gap is a PRE-EXISTING property of every policy suppression
  of non-schema-keyed objects (an `supabase_admin`-owned FDW chain has the
  identical behavior today); this PR widens its reach to the real Cloud
  ownership rather than introducing it. The PR is still strictly net-positive:
  before it, EVERY integration-bearing project planned unreplayable
  `CREATE FOREIGN DATA WRAPPER` DDL; after it, only the dependent-view subset
  still fails, and one step later. A principled fix is architecturally
  significant and general, not wrappers-specific: either (a) reference-only
  semantics for suppressed prerequisite chains + shadow-seed materialization
  (the `auth.users`-trigger mechanism, but keyed on objects rather than
  assumed schemas — needs seed-side support to materialize a foreign table
  whose server/extension are also suppressed), or (b) a plan-time
  "suppressed prerequisite" diagnostic: the projection-suppression collector
  already records every suppressed fact with attribution, so `plan()` can
  cross-check kept deltas' extraction-time edges against it and escalate
  warning→fatal exactly when a delta touches a stranded consumer (the
  `USER_MAPPING_UNREADABLE` precedent). Option (b) is the cheaper first step
  and benefits every suppression rule, not just Rule 6c.

## PR #403 review triage — the reserved `_custom/` folder

Round-1 findings were fixed in the PR (migration references must resolve to a
FILE, the pruner skips `_custom/` during traversal instead of after the walk and
no longer swallows FS errors, `COMMENT` left the modeled-kind allowlist,
`unmodeled_drift` diffs fully qualified identities, the `unmodeled_kind`
remediation is per kind, and `listCustomFiles` propagates non-ENOENT failures).
One finding is **deferred, won't-fix in #403**:

- **Foreign tables (and `SECURITY LABEL`) cannot be flagged by
  `custom_modeled_kind`.** pg-topo has no statement class for either — both
  classify as `UNKNOWN` (verified against the current classifier), and
  `_custom/` deliberately suppresses the `UNKNOWN_STATEMENT_CLASS` lint, so a
  `CREATE FOREIGN TABLE` parked in the reserved folder is hidden entirely even
  though pg-delta models foreign tables and will regenerate one into the managed
  tree. The correct fix is adding `CreateForeignTableStmt` / `SecurityLabelStmt`
  classes to pg-topo's classifier (`packages/pg-topo/src/classify/`) and listing
  them in `MODELED_STATEMENT_CLASSES`
  (`packages/pg-delta/src/frontends/custom-lint.ts`) — a cross-package change,
  out of scope for #403. Deferred rather than dropped because the failure mode
  today is LOUD, not silent: the duplicate `CREATE` makes the next
  export-then-apply fail to converge on the shadow load
  (`max_rounds_exceeded`), which is exactly the hazard the lint rule
  pre-announces rather than the hazard it prevents.

  Third instance of the same classifier-coverage gap (round-3 review
  finding): pg-topo has no class for `DropStmt` either, so a modeled DROP
  (`DROP TABLE …`, `DROP VIEW …`, etc.) parked in `_custom/` also classifies
  `UNKNOWN` and is hidden by the same `UNKNOWN_STATEMENT_CLASS` suppression
  — `custom_modeled_kind` cannot flag it because it never sees a
  drop-target class to compare against `MODELED_STATEMENT_CLASSES`. The
  hazard shape differs slightly from the create case: a create-then-drop of
  the same object in the shadow (the `_custom/` file creates it, the
  managed tree no longer does) makes the plan schedule dropping the LIVE
  object, not just fail to converge — though this is additionally gated by
  `--allow-data-loss` at apply time, so not silent either. Same correct fix:
  add drop-target statement classes to pg-topo's classifier
  (`packages/pg-topo/src/classify/`) and list them alongside the
  create-target classes in `MODELED_STATEMENT_CLASSES`
  (`packages/pg-delta/src/frontends/custom-lint.ts`). Bundling this with the
  foreign-table / `SECURITY LABEL` fix above is the efficient path, since
  all three land in the same two files.

- **The scratch-loader cluster-DDL preflight does not catch
  `GRANT … ON PARAMETER` (pre-existing).** Discovered while verifying the
  round-1 P1: the preflight's GRANT pattern
  (`src/frontends/load-sql-files.ts:415`,
  `/^\s*grant\b(?![\s\S]*\bon\b)/i`) deliberately exempts privilege grants,
  so `GRANT SET ON PARAMETER … TO …` loads into a co-located
  (`databaseScratch`) shadow and writes to `pg_parameter_acl` — a SHARED
  cluster catalog — while the scratch guard snapshots/restores only
  `pg_roles`/`pg_auth_members`. A plan/dry-run can therefore leave a
  parameter ACL behind on the live cluster. #403 removed the advice that
  steered users toward this (the `unmodeled_kind` remediation is now
  per-kind and never points cluster-shared kinds at `_custom/`), but the
  loader gap predates the PR and applies to any `.sql` in the tree.
  Follow-up: extend the preflight to refuse parameter-ACL grants (and audit
  for other shared-catalog writers, e.g. `ALTER ROLE … SET` is already
  covered?) in `databaseScratch` mode, or widen the snapshot/restore to
  `pg_parameter_acl`.

Round-4 findings (loop capped here per the automated-review policy — both are
re-litigations of already-resolved threads one corner deeper, under
user-constructed pathological setups):

- **Deferred — drift identity serialization is not injective for dotted
  quoted identifiers (Codex P2, round 4).** `probeUnmodeledIdentities`
  renders type/name components with plain `%s`-style joins, so `"a.b".c`
  and `a."b.c"` flatten identically and a pathological same-rendering pair
  across shadow/target can mask an `unmodeled_drift` warning. Accepted:
  the diagnostic is best-effort observability — a masked warning still
  fails loudly when the generated migration runs — and the setup requires
  dots inside quoted identifiers colliding across two databases. Fix if
  ever needed: quote each component (`quote_ident`/`%I`) in the identity
  projections (`src/extract/unmodeled.ts`).
- **Deferred — dangling `_custom/README.md` symlink bypasses the scaffold
  containment (Codex P2, round 4).** Round 3 fixed the symlinked `_custom`
  root; a dangling symlink at the leaf README path still lets
  `writeFileSync` create the file outside `outRoot` (`existsSync` is false
  for dangling links). One-line fix when next touched: create with the
  exclusive `wx` flag (O_CREAT|O_EXCL does not follow symlinks) in
  `scaffoldCustomReadme` (`src/frontends/custom-dir.ts`) and treat EEXIST
  as skip.

## PR #407 review triage (Codex) — platform-provisioned assumed-schema members

Context: PR #407 exempts platform-provisioned members of assumed schemas
(system-role-owned, e.g. `supabase_functions.http_request()`) from the
action-graph missing-requirement guard, so a DB-webhook trigger plans against
a target that has never had webhooks provisioned (Sentry SUPABASE-API-8CX).
Two round-2 findings were fixed in the PR (run-level `defaultOwner` override
excluded from provenance; descendant closure). One is **deferred by design**:

- **Deferred — the plan neither creates the platform object nor proves against
  a target that lacks it ("materialize the dependency before bypassing the
  guard", Codex P1).** Deliberate: the policy's managed view EXCLUDES platform
  objects — a user plan must never `CREATE SCHEMA supabase_functions` /
  `CREATE FUNCTION … http_request` (it may lack the privileges and would claim
  platform state as user state). "Assumed present" is the same contract as
  `assumedRoles`/`assumedSchemas`: a plan with `GRANT … TO anon` or
  `CREATE EXTENSION … SCHEMA extensions` equally fails on a target where the
  platform never provisioned those; the platform (mgmt-api / Supabase image
  migrations) owns provisioning, outside the plan. Consequence, accepted: an
  `apply()`/`provePlan()` run against a bare clone that lacks the webhooks
  infra fails at the CREATE TRIGGER — the same failure mode the other assumed
  kinds already have. Revisit only alongside the committed Supabase baseline
  (docs/roadmap/backlog.md), which is the mechanism that could seed platform
  objects into proof clones for all assumed kinds at once.

Round-4 findings (loop capped here per the automated-review policy — both are
contract re-litigation of the provenance heuristic under hypothetical setups,
not defects reachable on the shipped policy):

- **Deferred — explicit platform-owner designation instead of
  `assumedRoles \ {policy.defaultOwner}` (Codex P1, round 4).** The heuristic
  treats a policy-assumed role other than the policy's own declared default
  owner as a platform object owner within assumed schemas. For the shipped
  Supabase policy this is exact (`assumedRoles` = SUPABASE_SYSTEM_ROLES +
  `postgres`, `defaultOwner: postgres`). A CUSTOM policy that added a user
  role to `assumedRoles` would widen the exemption to that role's objects in
  assumed schemas. No shipped or known custom policy does this; the clean fix
  is a new `Policy` field (e.g. `platformObjectOwners`) — an API addition
  disproportionate to this bug fix. Revisit when a custom-policy consumer
  actually declares assumed user roles.

- **Refuted for the shipped policy — descendant closure covering "user-added"
  children of platform tables (Codex P1, round 4).** The claimed
  counterexample (a user-added `auth.users.custom_flag` column) is not
  creatable on Supabase: `ADD COLUMN` / `CREATE INDEX` / `ADD CONSTRAINT`
  all require table OWNERSHIP, which the user's `postgres` lacks on
  system-role-owned tables. The user-creatable children — a trigger, via the
  grantable TRIGGER privilege, and (**correction, 2026-08-29**) an RLS
  policy, via the platform's `supautils.policy_grants` GUC
  (supabase/postgres `ansible/files/postgresql_config/supautils.conf.j2`,
  which opens CREATE/ALTER/DROP POLICY to `postgres` on 24
  auth/storage/realtime tables it does not own) — are deliberately MANAGED
  (policy include rule 3 for triggers; the user-policy-surface include for
  policies, per-table for storage/realtime and schema-wide for auth), so the
  plan PRODUCES them and the requirement guard never consults the exemption
  for them. The original note's premise "CREATE POLICY requires ownership"
  was wrong on the Supabase platform; the conclusion stands because the
  policy carve-out manages those children. Auth-team answers recorded
  2026-08-29: (1) Auth never ships or manages RLS policies on its own tables
  — all policies there are user-managed (the invariant the schema-wide auth
  rule rests on); (2) the RLS/grant list drift on post-2024 auth tables is
  deliberate, no catch-up planned.

- **Follow-up — customer SELECT re-grants on auth tables (separate PR).**
  `postgres` holds `SELECT ... WITH GRANT OPTION` on the 16 auth tables of
  the 2024 `enable_rls_update_grants` migration, and the docs demonstrate
  `grant select on auth.users to ...`, but Rule 10 drops all ACL satellites
  on system-schema targets — so a customer's re-grant is lost on forks and
  declarative round-trips, same class of bug as the policies. Unlike
  policies, ACLs carry a grantor, so a clean provenance discriminator exists:
  grantor = `postgres` → customer intent. Needs its own RED→GREEN pass over
  the ACL include/exclude rules.

## PR #453 review triage (Codex) — user-policy surfaces

Context: PR #453 manages user RLS policies + `COMMENT ON POLICY` on
storage/realtime (per-table, mirroring `supautils.policy_grants`) and on auth
(schema-wide, per the Auth-team guarantee recorded above). One finding
**deferred by design**:

- **Deferred — the schema-wide auth rule can emit non-replayable DDL for a
  DECLARED policy on a non-grant-listed auth table (Codex P2, round 1).**
  Mechanics confirmed: applier capability v1 gates only FDW ACLs, so a user
  who hand-declares `CREATE POLICY … ON auth.passkeys` (a table outside
  `supautils.policy_grants`) gets a plan whose apply fails with PostgreSQL's
  own "must be owner of table" as the non-owner `postgres`. Deferred because:
  (a) the SOURCE direction can never produce such a policy — only
  `supabase_auth_admin` could create one and the Auth team guarantees it never
  will — so exports and DB-to-DB diffs never emit this spontaneously; (b) the
  failing input is a user declaring DDL the platform forbids them to run, and
  a loud PG error at apply is the honest diagnostic; (c) the alternative
  (mirroring the grant list) reintroduces the silent-drop failure whenever the
  platform widens `policy_grants` ahead of a pg-delta release — silent loss is
  the bug class PR #433/#453 exist to fix. Possible follow-ups if this bites
  in practice: a plan-time diagnostic when a managed policy's parent table is
  reference-only and outside the grant list (accepting the grant-list coupling
  the schema-wide rule deliberately avoids), and an integration leg on a
  supautils-configured image exercising the real ownership/grant matrix
  end-to-end (the current stand-in tables are owned by the applying role, so
  they validate diff/plan/export routing, not the platform's permission
  boundary). The COMMENT ON POLICY apply path is no longer in that bucket:
  the pinned image is `supabase/postgres:17.6.1.167` (supautils 3.4.0, which
  includes the 3.3.0 `COMMENT ON POLICY` elevation), and the REAL-997
  integration test applies as non-owner `postgres` against
  `supabase_admin`-owned stand-in tables.

## PR #412 review triage (Codex) — libpq sslmode semantics

Context: PR #412 restores the legacy engine's `sslmode` translation for
URL-based connections (`parseSslConfig`), fixing `sslmode=require` against
private-CA servers (CLI-2176). The MIGRATION.md pool-construction example was
fixed in the PR (round 1). Two findings are **deferred by design**:

- **Deferred — `sslmode=require` does not read `PGDELTA_*_SSLROOTCERT` env
  content (Codex P1, round 1).** Deliberate legacy parity, asserted by a
  dedicated unit test ("require does NOT read the env CA"). libpq's upgrade
  rule ("require behaves as verify-ca") triggers on a root CA *file*; the
  role-scoped env var is pg-delta's own PEM-content extension and env vars are
  ambient across invocations. Honoring it under `require` would let a CA set
  for one server silently enable chain verification against a different
  server whose URL carries `sslmode=require` (the standard Supabase URL
  shape), breaking connections that work today. Users who want env-CA
  verification say so with `sslmode=verify-ca`. Revisit only if consumers ask
  for an explicit opt-in (e.g. a parse option), not by flipping the default.
- **Deferred — `sslmode=prefer` does not fall back to plaintext when the
  server refuses TLS (Codex P2, round 1).** node-postgres has no
  per-connection retry, so a single pool config cannot express libpq's
  try-SSL-then-plaintext. node-postgres' native `prefer` handling, upstream
  pg-connection-string's `uselibpqcompat` mode, and the legacy engine all
  force TLS identically; a bespoke connect-retry wrapper in `makePool` is
  disproportionate. Documented as a limitation in the module header and
  MIGRATION.md. Revisit if node-postgres grows native fallback support.

## PR #410 review triage (Codex) — extension-replace member handling

Rounds 1–2 were real defects in the PR's own changes and were fixed in-PR
with RED-first regressions (member-satellite removal cycle, traverse-through
for member dependents, member-satellite replay, vanish-gate scoped to
`memberOfExtension` edges into destroyed extensions). Round 3 re-litigates a
pre-existing contract corner; loop capped here per the automated-review
policy.

- **Deferred — renamed dependents escape the forced-rebuild walk (Codex P1,
  round 3).** With `renames: "auto"`, `expandReplacements`' dependent check
  (`desired.has(edge.from)`) sees only the dependent's NEW id, so a dependent
  being renamed in the same plan is never rebuilt around a destroyed
  dependency — e.g. renaming a table whose column uses an extension-owned
  type while that extension is replaced yields `ALTER TABLE … RENAME` +
  `DROP EXTENSION` and PostgreSQL rejects the drop. This gap PREDATES PR
  #410 and is not extension-specific: the same shape exists for a rename
  crossing an enum/type replace (the walk has never carried the
  accepted-rename identity mapping). The clean fix is to thread
  `acceptedRenames` into `ReplacementExpansionInput` and translate ids during
  the walk — or to refuse the plan when a renamed dependent would need a
  rebuild (rename + rebuild of the same object in one plan is currently
  unexpressible). Disproportionate to the pg_net cycle fix; needs its own
  RED coverage for the rename × forced-rebuild matrix.

## PR #418 review triage (Codex) — planId content hash

Context: PR #418 adds required `Plan.planId` (WP1). Threat model: planId is an
**integrity check against accidental divergence** (stale/hand-edited artifacts
drifting from what was approved), NOT a security boundary — `computePlanId` is
a public export, so a deliberate artifact editor can always re-stamp. Findings
whose only failure scenario is a malicious editor gain nothing from hashing.

Fixed in the PR (rounds 1–3): preamble bound into the digest (it is executed
per segment — run content); `ENGINE_VERSION` bumped to 0.3.0 so pre-planId
executors fail closed on stamped artifacts; `assertPlanId` preflight added to
`provePlan()` so every public execution path validates before clone work.

- **Deferred — bind `projectionAudit` into planId (Codex P1, round 2).** The
  audit is gate INPUT under `prove --strict-audit`, so it is the one remaining
  field that neither fails loud nor is reporting-only. Not hashed yet because
  (a) the only exploit path is a deliberate editor (re-stampable → no
  adversarial gain), and (b) `parsePlan` runs `normalizeProjectionAudit`
  BEFORE the digest check, so inclusion requires proving normalize-stability
  between `plan()` output and re-parsed artifacts — a false "re-plan" reject
  is the worst failure mode this feature can have. If revisited: hash the
  NORMALIZED form on both sides and extend the round-trip suite with
  audit-bearing plans.
- **Declined — bind `source.endpointHash`/`source.identity` into planId
  (Codex P1, round 2).** These are transport stamps the CLI attaches AFTER
  `plan()` precisely so planId stays a transport-independent content
  identity (same plan against two replicas must share an id). They defend
  against accidental endpoint mixups (`prove --clone "$SOURCE_URL"`), which
  do not involve artifact editing; the described bypass requires a deliberate
  editor, who re-stamps.
- **Declined — bind `baseline.digest` into planId (Codex P2, round 2).**
  Baseline already fails loud on accidental drift: apply/prove reconcile the
  live-resolved baseline against the stamped digest (even under `--force`).
  The described bypass needs a deliberate two-step edit — re-stampable.
- **Declined — `major` changeset (Codex P1, round 1).** The package is on a
  0.x pre/alpha train (every bump releases as `-alpha.N`); the repo has never
  queued a `major`, and doing so would promote pg-delta to 1.0.0 the day
  `changeset pre exit` runs — a release-train side effect worse than the
  labeling nit. Breaking-in-alpha ships as `minor` here by established
  practice.
## CLI-2054 triage — pgmq intent capture and replay

- **RESOLVED in-PR — `plan()` now has a collision-scoped
  `intent-unsupported` gate** (Codex round-2 P1 sharpened the
  consequence: a regular→partitioned transition of the same queue name
  planned a bare destructive `drop_queue` whose proof falsely converged,
  because the desired re-extract skipped the fact too). It shipped first as
  an unconditional desired-side refusal mirroring the `INTENT_UNKEYED`
  check, then was narrowed to fire only when the opposite side manages a
  fact under the SAME key — an unconditional gate blocked benign diffs whose
  desired state merely contained a partitioned queue. Still open here: whether
  the intervals can be sourced from `part_config` once the pg_partman intent
  handler (CLI-2044) lands, making partitioned queues replayable instead of
  refused.

### PR #399 review triage (Codex)

Fixed: `drop_queue` now reports `lockClass: "accessExclusive"` (it DROPs the
`q_*`/`a_*` relations; the intent adapter's `"none"` default misrepresented a
destructive drop as lock-free in the safety report).

Deferred (recorded here, not fixed in the PR):

- **Old-pgmq catalog shapes are not probed.** `capture()` selects
  `is_partitioned`/`is_unlogged` from `pgmq.meta` unconditionally; a pgmq
  older than 0.31 (mid-2023, before those columns existed) fails extraction
  with a loud `undefined_column` naming `pgmq.meta`. Every pgmq Supabase has
  ever shipped (≥1.4) has both columns, so this is unreachable on the
  Supabase profile; it needs a raw/custom profile composed against a 3+
  year old pgmq. The failure is loud and actionable (upgrade pgmq or drop
  the handler from the profile), and pg-cron makes the same
  stable-catalog-shape assumption. Revisit only if a real profile hits it:
  the fix shape is a column-presence probe degrading to filter-only capture
  with a diagnostic.
- **User DDL referencing operational queue tables can order before the
  replay.** A user view/FK on `pgmq.q_<name>` has its dependency edge pruned
  when `resolveView` projects the `managedBy` table out, and intent replay
  sorts late (weight 90), so a from-empty apply can attempt the view before
  `pgmq.create()`. Referencing pgmq's operational tables in own DDL is
  discouraged upstream; before this PR the same desired state was strictly
  worse (no replay existed at all — the table never appeared); the
  declarative path converges through the loader's retry rounds and the
  plan/apply path fails LOUDLY via the proof, never silently. The clean fix
  (remap pruned dependency edges onto the intent fact before projection) is
  planner/resolveView machinery — deferred as its own design piece (the
  desired-side `intent-unsupported` plan() gate, originally bucketed with
  it, shipped in-PR after the round-2 P1).
- **Partitioned-queue interplay with `DROP EXTENSION pgmq`.** A partitioned
  queue emits no intent fact, so a desired state that removes pgmq relies on
  member-cascade to take the operational tables with it. Partitioned queues
  are already explicitly unmanaged (`intent-unsupported`); their removal
  semantics belong to the same follow-up that makes them replayable
  (part_config-sourced intervals, above), not to this PR.
Also fixed after the round-3 triage:

- **Partitioned→regular transition of the same queue name (Codex round 3) —
  now FIXED.** Source has a partitioned queue `X` (skipped, source-side
  diagnostic), desired declares a regular queue `X` (fact). The plan emitted
  `pgmq.create('X')`, which no-ops against the existing registration (pgmq's
  create is `IF NOT EXISTS`), so apply/proof failed to converge — loudly, via
  the proof backstop, but with a confusing fingerprint mismatch instead of a
  plan-time error. Originally declined because an early rejection needed
  source-side diagnostics to carry the queue key plus a diagnostic × opposite-
  side join in `plan()`. That machinery was then built anyway to
  COLLISION-SCOPE the desired-side gate (which was too strict — it blocked any
  diff whose desired state merely contained a partitioned queue), so the
  mirror-image direction came free: the same key-carrying context and the same
  `FactBase.has` probe, run the other way round. Both directions now throw at
  plan time naming the ext/intentKind/key and which side holds the unreplayable
  form. The residual corner (making partitioned queues replayable via
  part_config-sourced intervals) is still the follow-up above.

Round 4 (final round — loop capped per the automated-review policy):

- **Changeset overclaimed the raw profile's safety (Codex round 4) — FIXED.**
  The release note said "a `raw` or custom profile never plans `DROP TABLE`"
  against the operational tables, but `rawProfile` is `handlers: []` and never
  invokes the handler, so under `--profile raw` a source-to-empty diff still
  treats `pgmq.q_*`/`a_*` as ordinary managed tables. Reworded to scope the
  guarantee to profiles that compose the handler.
- **The `INTENT_UNSUPPORTED` collision gate probes PRE-filter fact bases
  (Codex round 4) — declined, recorded.** `plan()` checks
  `rawSource.has(id)` / `rawDesired.has(id)` before `buildChangeSet` applies
  policy or baseline projection, so a profile that composes `pgmqHandler`
  while simultaneously policy-filtering its intent facts would be over-blocked
  even though the filtered diff would produce no action. Declined because the
  configuration is contrived (a user wanting queues unmanaged simply omits the
  opt-in handler), the failure direction is fail-safe (planning refuses with a
  clear message naming the queue; no wrong DDL is emitted), and the placement
  mirrors the pre-existing `INTENT_UNKEYED` gate directly above it. If a real
  profile ever hits the over-block, the fix shape is to move the probe onto
  the kept-delta / managed views, mirroring the `USER_MAPPING_UNREADABLE`
  gate's zero-over-block approach lower in the same function.


## CLI-2044 triage — pg_partman `create_parent` intent capture and replay

- **Deferred — the DROP path needs a second sync round to converge.**
  Deregistering a parent is `DELETE FROM part_config` (`dataLoss: "none"`).
  There is no single-statement inverse of `create_parent`: `undo_partition()`
  requires a separate `p_target_table` to move rows into and is batched by
  `p_loop_count` (verified on pg_partman 5.3.1), so it cannot be rendered as a
  replay. The consequence is deliberate: once the `part_config` row is gone the
  premade children and the template table lose their `managedBy` tag and become
  ORDINARY user tables, which the plan — computed before that projection change
  — did not account for, so a one-shot `apply` leaves them behind and its proof
  reports drift. A second sync round then drops them explicitly under the normal
  data-loss gate. The alternative (an opaque `DO` block that mass-`DROP TABLE`s
  every descendant) was rejected: it would destroy partition data the user never
  saw planned. A converging one-shot drop needs the planner to re-project after
  an intent removal, which is planner machinery this slice deliberately left
  alone. Covered by an explicit assertion in
  `tests/extension-intent-partman.test.ts` ("drop: an unregistered desired state
  DEREGISTERS the parent without destroying a single partition"), which asserts
  the true two-round behaviour rather than a false convergence.

- **Deferred — sub-partitioned sets are scoped out, not replayed.** A
  `create_sub_parent` set writes a `part_config_sub` row on the top parent AND a
  partman-authored `part_config` row per sub-parent. Neither is a faithful
  `create_parent` replay, so both emit `INTENT_UNSUPPORTED` and no fact (their
  partitions stay `managedBy` at every level, so nothing is ever dropped).
  Replaying them needs a second intent kind driven by `part_config_sub` plus
  ordering between the two levels. Same fail-loud gap as pgmq's partitioned
  queues: a sub-partitioned set declared in the DESIRED state is silently left
  unmanaged rather than failing the plan — see the CLI-2054 triage above, whose
  `plan()`-level `intent-unsupported` gate would cover this case too.

- **Deferred — customizations to partman's AUTO-created template table are not
  captured.** `<partman_schema>.template_<parent_schema>_<parent_name>` is tagged
  `managedBy` and recreated by `create_parent`, so an index or default a user
  added to it is lost on a rebuild. Not fixed here because leaving it as an
  exported fact creates a worse failure: `create_parent` creates it
  `IF NOT EXISTS`, so under the default by-object export layout the later
  `CREATE TABLE` fails permanently with "already exists" and no retry round can
  recover. Users who need a customized template should supply their own via
  `p_template_table` — that path keeps full fidelity and is `consumes`-ordered.

- **Note for CLI-2054 (pgmq partitioned queues).** The CLI-2054 triage above
  anticipated that this handler would make pgmq's partitioned queues replayable
  by sourcing their intervals from `part_config`. That revisit is deliberately
  NOT done here — and after the PR #400 review fix below, pgmq-owned
  `part_config` rows (both the `q_` queue table and the `a_` archive table that
  `pgmq.create_partitioned` registers) are explicitly SKIPPED with an
  `INTENT_UNSUPPORTED` warning rather than captured. Capturing them produced a
  wrong replay: an export / from-empty plan contained
  `create_parent('pgmq.q_x', …)` consuming a table nothing in the plan creates,
  and a live↔live diff whose desired side lacked the queue planned a
  `DELETE FROM part_config` that would disable pgmq's own maintenance. Making
  partitioned queues replayable therefore needs BOTH a pgmq-side intent (the
  intervals re-sourced from `part_config`) and cross-handler ordering — a
  dependency no slice has taken on yet.

## PR #400 review triage (Codex) — pg_partman create_parent intent

Five findings; two fixed in the PR (partman scope only), two deferred here, one
redirected to the pgmq PR (#399).

- **Fixed — pgmq-owned `part_config` rows leaked into create_parent intents
  (P1).** See the reworded CLI-2054 note above for the failure modes. The fix
  resolves pgmq's installed schema from `pg_extension` and skips rows whose
  parent matches a registered queue in `<pgmq_schema>.meta` (both `q_` and `a_`
  prefixes — `create_partitioned` registers TWO parents, verified on pgmq
  1.5.1). Detection must come from the catalog: handler capture runs on the
  RAW pre-projection fact base, so neither fact presence nor cross-handler
  `managedBy` edges can identify the rows.

- **Fixed — `create_parent` under-reported its relation lock (P2).** The
  replay spec inherited the intent-rule default `lockClass: "none"`, but
  `create_parent` takes an explicit `LOCK TABLE … IN ACCESS EXCLUSIVE MODE` on
  the parent (`pg_partman--5.3.1.sql:1348`). Now `accessExclusive`. The
  settings `UPDATE` and the deregister `DELETE` stay `"none"` (plain row DML).

- **Deferred — version-keyed handler gating (P1/P2, two findings).** The
  partman capture projects 5.3.1-audited `part_config` columns
  (`time_encoder`, `maintenance_order`, …) and pgmq's projects `is_unlogged`;
  on an older installed extension version the query fails with
  `undefined_column` and aborts extraction instead of degrading to filter-only
  behavior. This is the `versions?` handler field the architecture doc already
  promises (`docs/architecture/extension-intent.md` §risks: "handlers are
  version-keyed; unsupported versions degrade to filter-only with a notice")
  but which was never implemented — and it equally affects the shipped pg_cron
  handler (comment-only "stable since 1.4" posture). Fixing it per-handler
  inside feature PRs is piecemeal hardening of a framework contract; do it
  once, across pg_cron + pgmq + pg_partman: resolve `extversion` in capture,
  compare against a per-handler supported range, and degrade to Phase-A
  tagging plus a diagnostic outside it.

- **Redirected to PR #399 — `pgmq.drop_queue` lock class (P2).** Valid
  one-liner (`drop_queue` drops the queue and archive tables → access
  exclusive), but it is pgmq-handler code owned by the stacked pgmq PR, not
  this one. Landed there (see the PR #399 triage above).

### Round 2 (post-rebase)

Codex's second pass ran against a rebase that had transiently dropped the
round-1 fixes (restored since), so one finding is a stale artifact. The other
two are real but out of this PR's partman scope; recorded here.

- **Stale — "the claimed accessExclusive fix is absent".** True of the
  reviewed commit only: the branch was rebased over the round-1 push before
  the re-review ran. The fix commits are restored on top of the rebase;
  nothing to change.

- **Verified, redirected to the plan/export plumbing — `schema export`
  bypasses the desired-side intent gates.** The chain is real:
  `buildSchemaExport` → `reconstructManagedView` → `resolveView` →
  `buildFactBase` (twice), and `buildFactBase` constructs a fresh
  `FactBase` whose `.diagnostics` is always `[]` (the constructor cannot
  carry them), so by the time `export-sql-files` calls `plan()` the
  desired-side `INTENT_UNKEYED` / `INTENT_UNSUPPORTED` gates read empty
  diagnostics and pass. Consequence: exporting a database that holds an
  unreplayable intent (partitioned pgmq queue, sub-partitioned partman set)
  silently emits an incomplete bare schema instead of failing loudly. NOT
  new to the partman PR — the `INTENT_UNKEYED` gate on main has the same
  hole for pg_cron — and the fix (preserve diagnostics across managed-view
  reconstruction, or evaluate the gate on the pre-projection base) is
  fact-base/plan plumbing shared with the gate that shipped on the pgmq
  side of this stack. Fix it there as its own slice, with an export-path
  regression test.

- **Deferred — arg-backed payload changes on a MATERIALIZED partition set
  do not converge (Codex round 2 raised the `p_default_table` true→false
  corner).** Every intent `payloadAttrs` entry is `"replace"` (drop +
  create), so any arg-backed change replays `DELETE FROM part_config` +
  `create_parent(...)` against a parent whose partitions (and default
  partition) already exist physically. For `defaultTable` specifically the
  replay cannot converge: `create_parent(p_default_table := false)` does
  not remove the existing default partition, and the next capture recomputes
  `defaultTable` from `pg_partitioned_table.partdefid`, so the diff
  reappears (the proof loop reports the drift — the failure is loud, not
  silent). This is one corner of a class: the intent-rule interface has no
  in-place ALTER hook, and the handler's `create()` sees only the desired
  fact, so a faithful transition (`DETACH`/`DROP` of the default partition
  under the data-loss gate) cannot be expressed today. Needs either an
  alter-capable intent rule or a planner-level transition gate — the same
  planner-machinery family as the two-round drop above. Until then the
  supported path for repartitioning a live set is partman's own tooling,
  not a pg-delta replay.

### Round 3

- **Fixed — the changeset's migration snippet called `resolveProfile(profile)`.**
  The real signature is `await resolveProfile(pool, profile)` (async, pool
  first), so a typed caller following the note verbatim failed to compile and
  an untyped one threw at runtime. Snippet corrected in the changeset.

- **Deferred — switching `templateTable` from partman's auto-created template
  to a user-supplied one orphans the old auto template.** A second instance of
  the materialized-set replace class above: the replacement replays
  `DELETE FROM part_config` + `create_parent(p_template_table := …)` without
  touching the old `template_<schema>_<name>` table, which the next capture no
  longer recognises as the configured auto template — it surfaces as an
  ordinary (empty) user table, the proof reports the drift loudly, and the
  second sync round drops it under the normal gate, exactly like the two-round
  deregister path. A faithful one-shot transition needs the same in-place
  ALTER hook / planner transition gate as the `p_default_table` corner, so it
  lands with that machinery, not piecemeal here.

## CLI-2219 cross-review triage — legacy-artifact detection after the `_relocatable` rename

The CLI-2219 fix moved `relocatable` out of the extension fact's hashed
payload (now `_relocatable` metadata). Cross-review confirmed three legacy-
artifact symptoms, all deferred per the established alpha re-capture posture
(precedent: the ENGINE_VERSION 0.2.0 search_path change invalidated every
fact hash with only a "regenerate your artifacts" note; snapshots carry no
engine-version stamp and FORMAT_VERSION describes the document shape, which
is unchanged). All three are documented in the release's changeset note;
none is silent data corruption — but none points the user at re-capture
either, which is the gap to close if pre-fix artifacts turn out to persist
in the wild:

- **Legacy snapshot vs fresh extract** — `plan()` throws the (now
  misleading) guardrail-3 `no rule for attribute 'relocatable'` error for
  every extension the snapshot carries; `pgdelta drift` reports false
  `.relocatable` drift. A decode-time key migration in `snapshot.ts` is
  feasible but must run AFTER digest verification (migrating first changes
  the recomputed rootHash and rejects the file as corrupt) and would be the
  first kind-aware code in the deliberately kind-free core — do it only if a
  consumer that persists v1 snapshots and cannot cheaply re-capture shows up
  (the mgmt-api incident path extracts both sides live).
- **Legacy baseline** — `subtractBaseline` matches on content hash, so a
  pre-fix baseline silently stops subtracting every extension fact (they
  leak back into exports/plans with no diagnostic). No baselines are shipped
  in-repo (the supabase policy's `baseline:` is commented out), so exposure
  is user-supplied only. A fail-loud guard in the same family as the
  documented `redactSecrets`-mismatch check (e.g. flag a baseline whose
  extension facts carry hashed keys the current extractor never emits) would
  convert this to an actionable error.
- **Two legacy snapshots planned against each other** — both sides lack
  `_relocatable`, so a non-relocatable extension's schema move loses the
  replace route and plans `ALTER … SET SCHEMA` (rejected loudly by Postgres
  at apply; `prove` also fails it pre-mutation).

### PR #435 review triage (Codex)

- **Deferred — a relocatability flip BETWEEN plan and apply is invisible to
  the fingerprint gate.** With `_relocatable` outside the hashed surface, an
  out-of-band `ALTER EXTENSION UPDATE` in the plan→apply window whose new
  version changes nothing catalog-visible except relocatability no longer
  moves `physicalSource.rootHash`, so the apply gate accepts the stale plan.
  This is the same trade the engine already makes for `version` itself (never
  hashed, by design): an update that changes any member definition still
  moves the fingerprint and is caught. The residual failure modes are loud or
  pre-approved — a stale `ALTER … SET SCHEMA` is rejected by Postgres and
  aborts the apply (re-plan resolves it), and executing the plan's
  DROP+CREATE against a now-relocatable extension still converges and only
  carries the dataLoss hazard the operator already accepted at plan time.
  Revalidating planner decision inputs at apply would need a general
  "plan-bound preconditions" channel (per-kind checks in apply are
  architecture-hostile); if that machinery ever lands, extension
  relocatability is its first customer.

- **Deferred — `_relocatable` in a snapshot is outside the digest (round 2,
  same family).** The snapshot digest folds `rootHash`, which excludes all
  `_`-prefixed metadata by the hash.ts contract — so an edited or corrupted
  `_relocatable` (like `_position` or `_configGucs` before it) passes
  `deserializeSnapshot()`. The digest is an integrity guard against
  ACCIDENTAL corruption, not authentication: it is stored in the same file,
  so a deliberate editor can recompute it regardless of what it covers.
  There is also nothing to independently validate against at decode time —
  the flag is control-file state of a database the snapshot may have
  outlived — and re-hashing it reintroduces CLI-2219. Blast radius of a
  wrong value is the same as the plan-to-apply drift entry above: a stale
  ALTER … SET SCHEMA is rejected loudly by Postgres, and an unnecessary
  replace converges with its dataLoss hazard surfaced at plan approval. If a
  "plan-bound decision inputs" channel lands (previous entry), snapshot-side
  authentication of those inputs belongs to the same machinery.

## PR #434 review triage — extension precheck identifier case

- **Deferred — preserve quoted-identifier case in extension shadow prechecks.**
  `findMatchingStatements` keeps quoted identifier text but discards the quote
  delimiters, so case-sensitive user objects such as
  `"Vault"."create_secret"()` or `"Cron"."schedule"()` become indistinguishable
  from the lowercase extension APIs and can trigger a false capability refusal.
  The case requires exact homographs and is unusual enough not to expand PR
  #434. A shared fix must retain quote delimiters for every shadow precheck,
  accept exact lowercase quoted API names, and keep PostgreSQL's case-folding
  behavior for unquoted names.

## PR #450 review triage (Codex) — pg-topo `privilege` payload

PR #450 adds `StatementNode.privilege` from GrantStmt / AlterDefaultPrivilegesStmt
so consumers can read default-ACL direction, roles, schema, and object kind
without regex on `sql`. Four Codex P2s were deferred; they are real AST gaps,
not the contract this PR promised.

- **Deferred — map every privilege `objtype`.** `OBJECT_DATABASE` / tablespace /
  large object / parameter fall through to `objectKind: ""`. This PR maps the
  ADP / table kinds the consumer asked for (`tables`, `sequences`, `functions`,
  …). Exhaustive cluster-object coverage is a later payload expansion.

- **Deferred — `CURRENT_USER` / `CURRENT_ROLE` / `SESSION_USER`.**
  `roleNameFromRoleSpec` already drops these (same hole on `requires[]`).
  Hosted dumps name roles (`postgres`, `anon`). Do not change the shared
  helper just to populate the new field.

- **Deferred — column-scoped privileges.** `GRANT SELECT (email)` stores
  `AccessPriv.cols`; the payload keeps `privileges: ["select"]`. Default ACL
  and privilege-offer do not need column lists; exposing them is a shape change.

- **Deferred — `WITH GRANT OPTION` / `REVOKE GRANT OPTION FOR`.** The AST
  `grant_option` flag is dropped, so those statements look like a plain
  grant/revoke. The consumer asked for GRANT vs REVOKE of the privilege
  itself, not grant-option bookkeeping.

## PR #455 review triage (Codex) — alter-after-dependency order

PR #455 orders an in-place ALTER after the in-place ALTER of a direct
dependency (SET DEFAULT vs ADD VALUE). Pairwise reciprocal depends (two
domains whose defaults reference each other) were fixed in-PR so the new
edge does not turn a valid fact cycle into an unsortable action graph.
Two round-2 Codex P2s are **deferred**:

- **Deferred — n-cycles of in-place-altered facts (3+ domain defaults,
  or a BEGIN ATOMIC function ring, all changing in one plan).** The
  pairwise back-edge skip does not see `d1 → d2 → d3 → d1`, so the new
  edges close an action-graph cycle and `topoSort` throws. Loud, not a
  silent wrong order. The 2-node case is the one that showed up in
  review; chasing n-node SCCs here is the same contract one hop at a
  time. A later change can skip edges whose endpoints sit in the same
  desired-depends SCC of currently-altered facts.

- **Deferred — transitive `depends` (column default → unchanged domain
  → enum being ADD VALUEd).** The new walk matches the produces walk:
  one hop on `outgoingEdges(subject)`. A default `'c'::dst` over an
  unchanged domain whose base type is the enum records `default →
  domain`, so ADD VALUE still falls through to the weight tie-break and
  can 22P02. Same hole already exists for CREATE of a new column/default
  through that domain. Fixing it properly is a transitive walk (or
  reachability-to-alterer) on **both** sides, with the SCC skip above,
  not an alter-only special case.
