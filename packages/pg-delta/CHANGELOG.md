# @supabase/pg-delta

## 1.0.0-alpha.48

### Minor Changes

- 54206c1: Keep user RLS policies and their `COMMENT ON POLICY` managed across the managed-schema surfaces the platform actually opens to users. The supabase profile's per-table allowlist now mirrors `supautils.policy_grants` for storage/realtime (adds `realtime.subscription`, `storage.buckets_analytics`, `storage.s3_multipart_uploads`, `storage.s3_multipart_uploads_parts`), and the `auth` schema is covered schema-wide: the Auth team guarantees the service never ships or manages RLS policies on its own tables, so every policy there is user intent — including on tables outside the grant list. Previously these policies (and all policy comments) were silently dropped from diffs, exports, and DB forks by the system-schema excludes. The policy DSL's `target` predicate gains a `table` sub-field to scope satellite rules to sub-entity targets. `storage.prefixes` is deferred to the next base-image sync; customer SELECT re-grants on auth tables are a recorded follow-up.

### Patch Changes

- 54206c1: Render `ALTER ROLE … SET search_path` as one string literal per list element (`TO 'public', 'extensions', 'realtime'`). A single quoted string collapsed a multi-schema path into one schema name, and an empty path emitted the invalid identifier `""`.

## 1.0.0-alpha.47

### Patch Changes

- Updated dependencies [7c9a23f]
  - @supabase/pg-topo@1.0.0-alpha.6

## 1.0.0-alpha.46

### Patch Changes

- 83d7180: Shadow-load assist warnings name the stuck file:line, the statement to move (or a suggested loadOrder), and session-setting statements that poisoned the connection. The same text is emitted through `onWarning` and `loadDiagnostics`.

## 1.0.0-alpha.45

### Patch Changes

- fee149f: Shadow load uses export `loadOrder` (else caller/lex order) first, reconnects once on a stuck session, then `reorderOnFailure` file-kind / statement-kind with a warning so authors can fix the tree.

## 1.0.0-alpha.44

### Patch Changes

- 775aba6: fix: a `statement_timeout` that fires on extraction's jit-disable round trip now surfaces as the typed `ExtractionTimeoutError` (with query label and budget) instead of the raw SQLSTATE 57014 pg error

## 1.0.0-alpha.43

### Minor Changes

- d54f79c: Refuse a PostGIS schema relocation instead of planning `DROP EXTENSION postgis`.

  PostGIS is non-relocatable (`extrelocatable = false`). When source and desired
  disagree on its schema, the generic rule would replace it — `DROP EXTENSION`
  cascades over every geometry/geography column and `spatial_ref_sys`. The plan
  now fails with an actionable error naming both schemas and asking the
  declaration to match the installed location. An explicit `DROP EXTENSION
postgis` (extension absent on the desired side) is unchanged.

- 1bf1b2b: feat(pg-delta): keep user RLS policies on storage/realtime surfaces through the supabase filter

  RLS policies on `storage.objects`, `storage.buckets`, and `realtime.messages` were marked reference-only by the managed-schema exclude (assumed schema + Rule 4) and silently dropped from diffs and declarative exports. The supabase profile now includes policies on those surfaces — the platform seeds none, so any policy present is user-authored. `auth` policies and other managed-schema tables stay excluded.

- d54f79c: Encode the supabase_vault presence-only contract (CLI-1434).

  The generic path already plans CREATE/DROP EXTENSION supabase_vault. This
  adds a raw-profile shadow precheck so alpine shadows fail early on
  `vault.create_secret` / `CREATE EXTENSION supabase_vault`, and a plan-time
  `vault_presence` warning when vault is in use (catalog dependents, never
  secret rows) or is being dropped. The warning is exposed through the public
  hazard classifier and blocks only under `--strict-coverage`. The supabase
  profile still filters vault as platform state.

### Patch Changes

- 93a5350: Fix the guardrail-3 plan failure (`rule table: kind 'extension' has no rule for attribute 'relocatable'`) when the two sides of a diff hold the same extension at versions whose control files disagree on `relocatable` (e.g. `wrappers`, which flipped relocatability across its release history). `relocatable` is a control-file property of the installed extension version — not settable by any DDL — so it now rides on the extension fact as non-hashed metadata (`_relocatable`), excluded from the diff/hash surface for the same reason `version` is, while staying readable at plan time for the schema rule's replace-vs-alter decision. That plan-time check now also consults the source-side fact: the ALTER executes against the source database, so a schema move across a relocatable flip routes to drop + recreate instead of an `ALTER EXTENSION … SET SCHEMA` the live database would reject.

  Note: extension fact content hashes change with this release. Re-capture any stored snapshots and baselines from earlier versions before using them with this release — a legacy snapshot diffed against a fresh extract fails `plan()` with the guardrail-3 error above for every extension it carries (and reports false `.relocatable` drift in `pgdelta drift`), a legacy baseline silently stops subtracting extension facts, and a plan between two legacy snapshots loses the non-relocatable replace route for extension schema moves.

- 2318f97: Declarative export now files `ALTER SEQUENCE … OWNED BY` with the owning table instead of the sequence file, so a file-atomic shadow load can create the sequence before `CREATE TABLE … nextval`.
- bc72ae5: `loadSqlFiles` / `planSchemaFiles` now fall back to per-statement apply when a file cannot commit atomically (`statementFallback` defaults to on). Pass `false` to restore whole-file rollback. `LoadResult.splitFiles` names files demoted this load.
- bd6e75b: The supabase profile now drops the platform `log_min_messages` parameter ACL grants (`supabase_admin` SET/ALTER SYSTEM, `supabase_realtime_admin` SET) from `unmodeled_kind` coverage. User parameter ACLs are still reported. Raw extract is unchanged.
- d54f79c: Recognize dump-style quoted `CREATE EXTENSION "supabase_vault"` in the raw-profile shadow precheck, and treat a `depends` edge onto the extension itself as vault-in-use (extract folds vault proc/type members to the extension id).

## 1.0.0-alpha.42

### Major Changes

- 3b4b5bc: **Breaking:** flatten the default declarative-export tree.

  `schema export` now writes one directory **per schema at the root** of the
  output directory and puts the cluster-level files under `_cluster/`:

  ```text
  schema/
    _cluster/roles.sql
    app/schema.sql
    app/tables/users.sql
  ```

  Previously those paths were `schemas/app/tables/users.sql` and
  `cluster/roles.sql`. Nothing below the root segment changed, and the loader is
  structure-agnostic, so `schema apply --dir` and `load(export(db)) ≡ db` are
  unaffected — but a re-export into an existing directory will move every file.

  - Pass `pathStyle: "nested"` (library) or `--path-style nested` (CLI) to keep
    the previous paths.
  - `pathStyle` composes with every `layout` (`by-object`, `ordered`, `grouped`).
    Under `ordered` the flattened file names get correspondingly shorter
    (`0001_app_tables_users.sql`).
  - A schema named `_cluster` or `_custom` — the two directories the export tree
    reserves at its root — or any case variant of one escapes its leading
    underscore (`%5Fcluster/`, `%5FCUSTOM/`) so it can never claim, or case-fold
    into, one of them on a case-insensitive filesystem.

## 1.0.0-alpha.41

### Minor Changes

- ad261ed: Capture and replay pg_partman parent registrations as extension intent (CLI-2044).

  Registering a partitioned parent with pg_partman is not schema DDL —
  `partman.create_parent(...)` is a function call that writes a row to partman's
  own `part_config` registry and premakes the child partitions. Until now a
  from-scratch declarative rebuild therefore produced a BARE
  `PARTITION BY RANGE` parent: no registration, no children, no maintenance.

  `pgPartmanHandler` now captures each `part_config` row as an `extensionIntent`
  fact keyed by the catalog-canonical `<schema>.<table>` and replays it through
  partman's own API — `select partman.create_parent(…)`, ordered after
  `CREATE EXTENSION pg_partman` (a `depends` edge) and after the parent's
  `CREATE TABLE` (a `consumes` edge). The eleven intent columns `create_parent`
  has no argument for (retention, `optimize_constraint`,
  `infinite_time_partitions`, …) replay as a follow-up `UPDATE part_config`,
  emitted only when they differ from partman's own defaults, so they are neither
  lost nor noisy. A database containing a configured parent now round-trips
  through `schema export` → load into a fresh shadow → re-extract with an empty
  diff and an identical `part_config` row.

  The full `part_config` column disposition — which of the 29 columns are intent
  reachable from a `create_parent` argument, intent settable only by updating
  `part_config`, or pure runtime state — is documented in the handler header and
  in `docs/architecture/extension-intent.md` §3.3.1, audited against pg_partman
  5.3.1.

  Deliberate scope, each recorded in `docs/roadmap/pg-delta-next-follow-ups.md`:
  removing a registration DEREGISTERS it (`DELETE FROM part_config`,
  `dataLoss: "none"`) and destroys no partition — `undo_partition()` needs a
  separate target table and is loop-batched, so it is not renderable as a replay —
  which leaves the orphaned partitions for an explicit second sync round.
  Sub-partitioned sets (`create_sub_parent`) emit the `intent-unsupported` warning
  instead of a fact that could never converge. Phase A is unchanged: every
  partition at every level stays tagged `managedBy`, so nothing ever plans a
  `DROP TABLE` against them, and partman's auto-created template table is now
  tagged too.

  Note for existing callers passing `pgPartmanHandler` to `extract()` and then
  driving `plan()` directly: the handler now emits intent facts, and `plan()`
  must be given their replay rules or the rule resolver throws rather than
  silently dropping declared intent. The supported way to obtain them is a
  profile: wrap the handlers in an `IntegrationProfile`
  (`{ id, handlers: [pgPartmanHandler, …] }`), call
  `await resolveProfile(pool, profile)` (async — it resolves against a live
  connection), and spread the returned `planOptions` (which carries
  `intentRules`) into `plan()` — hand-assembling the recipe without a profile is
  not a supported composition.

- 46fee37: Capture and replay pgmq queues as extension intent (CLI-2054).

  A pgmq queue is not schema DDL — `pgmq.create('jobs')` registers a row in
  pgmq's own `pgmq.meta` registry and creates two operational tables. The new
  `pgmqHandler` captures each queue from `pgmq.meta` as an `extensionIntent` fact
  keyed by `queue_name` (its unique registry key, so a queue is never unkeyable)
  and replays it through pgmq's own API: `select pgmq.create(…)` /
  `select pgmq.create_unlogged(…)`, and `select pgmq.drop_queue(…)` marked
  `destructive` because dropping a queue destroys its messages. The handler also
  tags each queue's `pgmq.q_*` / `pgmq.a_*` tables `managedBy` the extension, so
  any profile composing it — the `supabase` profile, or a custom profile
  referencing `"pgmq"` — never plans `DROP TABLE` against them. The default `raw`
  profile composes no handlers and does not get this protection.

  This closes the loop that was previously unprovable: a database containing a
  queue now round-trips through `schema export` → load into a fresh shadow →
  re-extract with an empty diff, because pgmq — unlike pg_cron — has no
  single-database constraint and needs no `shadowPrecheck`.

  The handler is composed into the `supabase` profile and is referenceable as
  `"pgmq"` from a custom `--profile <file>`. It takes no configuration: unlike
  pg_cron, `pgmq.meta` records no owner or role, so there is nothing to normalize
  and no superuser-only argument to elide.

  Partitioned queues are deliberately left unmanaged: `pgmq.meta` records only the
  `is_partitioned` flag, while `create_partitioned`'s partition and retention
  intervals live in pg_partman's `part_config`, so a faithful replay is not
  derivable from pgmq's catalog. Such a queue emits a new `intent-unsupported`
  warning instead of a fact that could never converge — its operational tables are
  still tagged, so nothing plans to drop them.

  That warning is non-blocking on its own: a diff whose desired state merely
  contains a partitioned queue — including the steady state where both sides have
  the same one — still plans, and the queue is simply left alone. `plan()`
  escalates to an error only on a same-key COLLISION, where the opposite side
  manages a regular queue of the same name and acting on the diff would be wrong
  either way: a partitioned queue declared over a source's regular one would
  otherwise plan a bare destructive `pgmq.drop_queue(...)` whose proof falsely
  converges, and the reverse (regular declared over a source's partitioned one)
  would emit a `pgmq.create(...)` that no-ops against the live registration and
  fail the proof much later. Both directions are now refused up front, naming the
  queue and the side that holds the unreplayable form.

### Patch Changes

- 21d4c6f: Replace the per-replace scan over the full extension-member closure in the
  satellite-replay loop with an inverted extension → members index plus an
  extension kind guard. Emission order and rendered SQL are unchanged; plans with
  wide replace sets on extension-heavy schemas (PostGIS, TimescaleDB) no longer
  pay O(replaced facts × total extension members), and extension-free plans skip
  building the closure entirely.
- 6c36986: Add an opt-in bypass for the shadow-vs-target same-database identity refusal.

  A physically restored shadow — a warm shadow cache rehydrated from a PGDATA
  snapshot of the target cluster, as the Supabase CLI provisions — inherits the
  target's `system_identifier` and every database OID, so the identity guard
  cannot tell it apart from the target and refused to load declarative SQL,
  blocking declarative sync whenever the shadow cache was on.

  `planSchemaFiles` now accepts `allowSameDatabaseIdentity`, and `schema apply`
  accepts `--allow-same-database-identity`, to proceed in that case; both emit a
  loud warning naming what was bypassed. Default behavior is unchanged (the
  refusal still fires), and both refusal messages now explain that physically
  cloned shadows legitimately trigger the guard and name the escape hatch.

  The pre-existing PostgreSQL-lineage containment guards (`isolatedShadow` /
  `--scope cluster` / `--isolated-shadow`, which check `systemIdentifier` alone)
  are now also exempted, but only for the exact-identity match the bypass
  already covers — a physical clone shares the target's lineage by construction,
  so without this the lineage guard would reject the very case the bypass exists
  to allow. A same-lineage **sibling** database (same system identifier,
  different database OID — a genuinely different database on the same cluster)
  is not covered: it still fails `isSameDatabase()` and the lineage guards still
  refuse it even with the flag set.

- a758961: Suppress FOREIGN DATA WRAPPER diffs for Supabase Wrappers-provisioned FDWs under the `supabase` policy (CLI-1470). Dashboard-provisioned wrappers (Wasm and native) are created via supautils and end up owned by `postgres` on Cloud, so the system-role owner rule never excluded them and plans leaked superuser-only `CREATE FOREIGN DATA WRAPPER … HANDLER extensions.wasm_fdw_handler` DDL. The policy now excludes FDW facts whose handler/validator come from the `wrappers` extension (a `depends` edge onto the extension fact, via pg_depend endpoint resolution); their servers, foreign tables, and user mappings cascade out through the managed-view projection. User FDWs with hand-rolled handlers keep round-tripping. The `wrappers` extension itself is now also platform-managed (like `pg_graphql`): it is dashboard-installed, and with its FDWs projected out a managed `DROP EXTENSION "wrappers"` would be a bare drop PostgreSQL rejects. Also extends the policy DSL's `edgeTo` predicate with a `name` glob sub-field.

## 1.0.0-alpha.40

### Minor Changes

- b5a4666: Export `actionHazards` / `classifyPlanHazards` with stable `HazardKind` codes derived from proof-verified action safety fields and coverage diagnostics. Policy (which hazards block which target) stays in the caller. Hazard kinds are not stored on `Plan`/`Action` and are not part of `planId`.
- 751f749: Export `hasBlockingDiagnostics` / `STRICT_COVERAGE_CODES`, `dataLossActions`, and database-identity helpers (`SourceDatabaseIdentity`, `observeDatabaseIdentity`, `databaseIdentityStamp`, …) from the package root and `@supabase/pg-delta/frontends`. CLI policy helpers (`printDiagnostics`, `exitIfBlocking`, `assertDataLossAllowed`) stay in `pgdelta`.
- 68a3035: Export `Segment`, `segmentActions`, and `planSegments` from the package root and `@supabase/pg-delta/frontends` so library consumers can group a plan into apply transaction segments without importing `src/apply/apply.ts`.

## 1.0.0-alpha.39

### Minor Changes

- dd843ab: Export `classifySqlFiles` / `classifySqlContent`, a pure helper that classifies a proposed declarative export against an existing tree (`created` / `updated` / `unchanged` / `removed` / `unmanaged`) without writing or deleting files. The Supabase CLI can compose this for `schema pull`; `pgdelta schema export` keeps staging, unmanaged-file refusal, and install.
- 8cac632: Require `Plan.planId`, a SHA-256 content hash over the plan-bound approval ingredients (format/engine version, source/target fingerprints, the preamble, accepted renames, the ordered action list, and profile/scope/policy). `plan()` stamps it; `parsePlan` and `apply()` refuse a missing or mismatching digest. Stale artifacts without `planId` must be re-planned — they are never silently upgraded.
- 551e88b: Export `pruneStaleSqlFiles`, `renderApplyScript`, and `probeUnmodeledIdentitiesPinned` from the package root and `@supabase/pg-delta/frontends` so library consumers can prune stale schema files, render a dry-run apply script, and probe unmodeled drift without importing `src/cli/**` or unexported frontend modules. `pgdelta` already used them internally.

  `pruneStaleSqlFiles` now resolves relative `keep`/`previouslyOwned` entries against `outRoot` (absolute entries are unchanged), so a consumer passing outRoot-relative paths cannot misread kept files as out-of-set — which under `pruneUnmanaged` would have deleted them.

### Patch Changes

- d5ac415: Export the named `LoadSqlFilesOptions` type from the package root. Library default for `strictDataStatements` remains permissive (`false`).

## 1.0.0-alpha.38

### Patch Changes

- df2178a: Restore libpq-compatible `sslmode` semantics for URL-based connections (CLI pools and `provisionCoLocatedShadow`), fixing `SELF_SIGNED_CERT_IN_CHAIN` failures against servers with private-CA chains under `sslmode=require`. `require`/`prefer` without a root CA now encrypt without chain verification (matching psql and the legacy engine); `verify-ca`/`verify-full` keep verifying (`verify-ca` skips hostname checks per libpq only when a CA is supplied; without one it keeps full verification against Node's default trust store instead of erroring like libpq); `require` + `sslrootcert` upgrades to verify-ca behavior; `sslrootcert`/`sslcert`/`sslkey` query params (file paths) and `PGDELTA_{SOURCE,TARGET}_SSLROOTCERT/SSLCERT/SSLKEY` env vars (PEM content) are honored. The translation is exported as `parseSslConfig(url, role?)` so library consumers building their own pools can opt in. URLs without a recognized `sslmode` pass through to node-postgres untouched.

## 1.0.0-alpha.37

### Patch Changes

- a204214: Fix the planner dependency cycle when a non-relocatable extension is replaced
  (e.g. pg_net installed in different schemas on the two sides). The forced
  dependent rebuild no longer promotes reference-only extension members into
  standalone DROP/CREATE actions, and actions that consume an extension member
  now order against exactly one side of the replace (teardown before the DROP,
  build-up after the re-CREATE) instead of impossibly against both.

## 1.0.0-alpha.36

### Minor Changes

- 113414e: `pgdelta schema export` now reports a per-file change summary — the final
  `Exported N file(s) ...` line includes how many files were created, updated,
  and unchanged (stale removals were already reported). Byte-identical files —
  including the `.pgdelta-export.json` manifest — are no longer rewritten, so
  mtimes across the output directory stay stable for build tools watching it.
  `writeExportFiles` returns the classification as `created` /
  `updated` / `unchanged` alongside the existing `removed` / `unmanaged` lists.

## 1.0.0-alpha.35

### Minor Changes

- d0be5d5: feat: opt-in bounded-parallel extraction via `ExtractOptions.concurrency`.

  `extract(pool, { concurrency: 4 })` now exports the coordinator's snapshot with
  `pg_export_snapshot()` and fans the catalog families out over that many
  connections from the same pool, all importing that snapshot — so the capture is
  still one consistent moment in database time. It exists for high-latency links,
  where serial extraction is dominated by its sequential catalog round trips rather
  than by work (see the batched-catalog changeset for the current count).

  The output is byte-identical to a serial extraction — same facts, same edge
  order, same diagnostics order, same fact-base fingerprint — because per-family
  results are slotted by family index and merged in the fixed call order, never in
  completion order. Default (`1` / unset) keeps the serial, single-connection
  capture.

  Requesting more streams than the pool's `max` clamps to it (the coordinator holds
  a client for the whole extraction, so over-requesting would deadlock on
  `connect()`), with a hard cap of 8. If the snapshot cannot be shared — a standby,
  a pooler that blocks `SET TRANSACTION SNAPSHOT`, a `max: 1` pool — extraction
  degrades silently to serial with no extra diagnostic.

- a86caa8: `schema export` now reserves a `_custom/` directory at the root of the export
  tree: it is never written into, never pruned (not even with
  `--prune-unmanaged`), never counted as an unmanaged file (so a re-export no
  longer refuses on it), and never recorded in `.pgdelta-export.json`. It is the
  durable home for SQL pg-delta detects but does not model (casts, operators,
  text-search objects, … reported as `unmodeled_kind`) and for idempotent DML —
  `schema apply` already loads it into the shadow, so a modeled object depending
  on an unmodeled prerequisite (an index over a custom text search configuration,
  say) elaborates again. Its files are never executed against the target; deliver
  them through your normal migration channel, optionally recorded per file with a
  head-of-file `-- pgdelta-migration: <path>` (or `none`) comment. On export a
  `_custom/README.md` documenting the contract is scaffolded once, `schema lint`
  gains four warnings (`custom_missing_migration_ref`,
  `custom_dangling_migration_ref`, `custom_conflicting_migration_ref`,
  `custom_modeled_kind`), and the `unmodeled_kind` diagnostic now points at the
  folder.
- a86caa8: Planning now pre-flights the gap the reserved `_custom/` folder creates. Raw SQL
  — managed and custom alike — executes only in the disposable shadow, so the
  shadow can hold unmodeled objects (casts, operators, text-search objects, …) the
  target has never received; because unmodeled kinds produce no facts, the diff is
  blind to them and no planned statement can create them, yet a generated statement
  depending on one fails on the target. `planSchemaFiles` (and hence `schema apply`,
  including `--dry-run`) now probes both catalogs and emits one `unmodeled_drift`
  warning per kind the shadow has and the target lacks, listing the missing
  identities — printed under the `[drift]` label, carried on the new
  `PlanSchemaFilesResult.driftDiagnostics`, and blocking under
  `--strict-coverage`. It is catalog-sourced only: nothing parses SQL, and the
  reverse direction (target extras) is deliberately not reported.

  Two frontend seams ship alongside it, for tools that own the migration channel
  and can automate delivery instead of asking the user to. The new
  `listCustomFiles(root)` returns every `_custom/**/*.sql` with its body and its
  parsed `-- pgdelta-migration:` directives plus a `delivered` flag (a recorded
  migration, or an explicit `none`), so a frontend can fold the undelivered files
  into the catch-up migration it already generates and stamp the directive back —
  run-once semantics come from its own migration ledger, and pg-delta still
  executes nothing against a target. And `schema lint` gains
  `--custom-migration-refs warn|off` (default `warn`), where `off` silences
  `custom_missing_migration_ref` alone for exactly those frontends; the dangling and
  conflicting rules are never suppressible, because a recorded-but-wrong reference
  is a bug whoever wrote it.

### Patch Changes

- d0be5d5: perf: batch the cheap catalog families into a few multi-statement round trips —
  a full extraction now costs 23 round trips instead of 38.

  Extraction issued one round trip per catalog family, and most of those families
  (roles, schemas, tables, sequences, views, domains, types, collations, event
  triggers, rules, publications, inheritance edges) are cheap enough that their
  entire cost is network latency. Their statements now travel as three
  multi-statement batches, while the measured server/transfer-heavy families
  (columns, constraints, indexes, routines, aggregates, triggers, policies) and the
  pg_depend resolver keep a round trip each — both so the parallel scheduler can
  spread the expensive work and so a `statement_timeout` still names the exact query
  that blew the budget. On a remote database at ~85ms RTT that is roughly 1.3s per
  serial extraction, and a diff extracts twice; at concurrency 5 the longest stream
  drops from 12 round trips to 8.

  Extraction output is unchanged, and provably so: no query text changed (only where
  it is sent), every family still gets its own collector, and the collectors are
  merged in the same fixed family order as before — so facts, edges, diagnostics
  order and the fact-base fingerprint are byte-identical for both the serial and the
  bounded-parallel path. `statement_timeout` remains per-statement inside a
  multi-statement batch, so the budget is not weakened. The serial path is now
  literally the one-stream case of the parallel plan rather than a second
  implementation.

  Three families are deliberately left unbatched — foreign-data objects,
  subscriptions and security labels each branch on the result of their own
  permission/existence probe, so their statement list is not knowable up front.

- d0be5d5: perf: batch the extraction session preamble into 2 round trips instead of 4-5.

  Every extraction — not just the opt-in parallel one — used to spend a separate
  round trip on each of `BEGIN`, `SET LOCAL search_path`, the optional
  `SET LOCAL statement_timeout`, the server-version probe, and the JIT-disable
  before touching a single catalog. These now travel as one multi-statement batch
  (plus a second round trip for JIT-off, whose form depends on the major version
  that same batch discovers), so the fixed cost before extraction starts drops from
  4-5 RTT to 2. On a remote database at ~85ms RTT that is roughly a quarter of a
  second per extraction, and a diff extracts twice.

  Session state after setup is unchanged and asserted to be identical
  (`search_path`, `statement_timeout`, `jit`, isolation level, read-only).

- 1fa625a: fix: the action-graph missing-requirement guard no longer rejects a plan whose action consumes a role that is absent from the managed view but witnessed by the source side (Sentry SUPABASE-API-8CX, pattern B). The `database` scope projects every `role` fact out of both views, and only roles referenced via `owner` edges (or a caller-supplied `assumedRoles` list) were exempted — so a database-scoped DB↔DB diff tearing down a grant to a role that owns nothing threw `missing requirement: … consumes role:<name>` even though the role provably exists on the apply target. plan() now treats any role referenced by a fact kept in the SOURCE view — an ACL grantee, a default-privilege FOR-role/grantee, a membership endpoint, a user-mapping role, an RLS policy TO-role — as present at apply time: the source view is the target's own extract, and PostgreSQL cannot record such a fact for a nonexistent role. Desired-side references with no source witness still fail loudly at plan time.
- a2ac70d: Speed up `plan()` on large catalogs. Six behavior-preserving changes to the
  planner's hot loops — the compiled-glob cache in policy matching, a per-object
  memo for stable-id encoding, an objtype index for the default-ACL elision's
  `ALTER DEFAULT PRIVILEGES` gate, memoized tie keys in the topological sort,
  skipping the rename discovery diff when `renames` is `"off"` (the default), and
  building the managed view's projection in a single `buildFactBase` pass.

  Measured on a 21.9k-fact catalog (p50 of 10 timed reps, back-to-back on one
  machine): a tiny-delta plan drops from ~604ms to ~294ms under the Supabase
  profile and from ~248ms to ~183ms under the raw profile, and a from-empty plan of
  the whole catalog from ~2.46s to ~486ms. The rendered plan SQL is byte-identical
  (sha256) and action counts are unchanged in every cell.

- a86caa8: `pgdelta schema lint` no longer emits `UNKNOWN_STATEMENT_CLASS` for statements inside the reserved `_custom/` directory, since that folder is the documented home for SQL pg-delta does not model (casts, operators, text-search objects, ...); the warning still fires everywhere else, and `custom_modeled_kind` still catches modeled DDL mistakenly parked in `_custom/`.
- d050eca: Fix the planner's missing-requirement guard rejecting DB-webhook triggers (`CREATE TRIGGER … EXECUTE FUNCTION supabase_functions.http_request(...)`) when the target database has never had the webhooks infrastructure provisioned. A platform-provisioned member of an assumed schema — an object owned by a policy-declared assumed role other than the default owner, such as `supabase_functions.http_request()` (owned by `supabase_functions_admin`) — is now treated as present at apply time by the same platform guarantee that makes its schema assumed. User-created objects in assumed schemas (owned by the default owner or a user role) still fail fast at plan time when the target lacks them.

## 1.0.0-alpha.34

### Major Changes

- 52cb22a: **`pg-delta` is now a clean-room rewrite.** The published `@supabase/pg-delta`
  package no longer wraps the legacy per-object-type diff engine — it is the
  ground-up rebuild previously developed as `@supabase/pg-delta-next`, promoted
  into place. This is a hard breaking change: the CLI, the public API, and every
  persisted artifact format are new. Nothing carries over from the legacy engine
  for compatibility. The legacy engine's last release is `1.0.0-alpha.33`, which
  remains installable from npm; its source is in git history.

  **Why it's different.** PostgreSQL is the only elaborator: state is resolved by
  a real Postgres instance (a live DB, or a shadow DB populated from your `.sql`
  files) and read back out of the catalog into a normalized, content-addressed
  fact base. Diffing is generic (no per-object-type change classes), ordering
  needs no hand-written cycle-breakers, and every migration is **proved** before
  you trust it — applied to a clone, re-extracted, and checked for both state
  convergence and data preservation.

  **New CLI surface** (`pgdelta`): `plan`, `apply`, `render`, `prove`, `diff`,
  `drift`, `snapshot`, `schema export`, `schema apply`, `schema lint`. Redesigned
  public API across the `.`, `./extract`, `./plan`, `./apply`, `./proof`,
  `./frontends`, `./sql-order`, `./sql-format`, `./core`, `./policy`, and
  `./integrations` subpaths.

  Highlights folded into this release (previously tracked as individual
  `pg-delta-next` changes):

  - **Declarative schema export/apply** with `by-object` / `ordered` / `grouped`
    layouts, co-located shadow/seed, management scope (`database` | `cluster`), and
    an optional `@supabase/pg-topo`-backed statement-reordering assist plus a
    database-free `schema lint`. **Export is a source-of-truth artifact**: SQL is
    pretty-printed by default (`--no-format` opts out), validated constraints fold
    inline into `CREATE TABLE`, indexes co-locate with their owning relation, and
    mutually-referencing foreign keys round-trip — all under the
    `load(export(db)) ≡ db` fidelity gate.
  - **Integration profiles** (`raw` | `supabase` | loadable custom profiles) with
    extension intent handlers (e.g. `pg_cron`, `pg_partman`) and assumed
    schemas/roles for platform-managed ambient dependencies. A profile can declare
    its own **baseline** — a `snapshot` subtracted from both sides so platform
    objects (base-image roles, extension-owned schemas) stay invisible with no
    per-command flag; its digest is stamped on plan/export artifacts and reconciled
    at apply/prove so `plan == prove == apply` holds (a swapped/edited/missing
    baseline fails loud). `diff` / `drift` / `snapshot` gained `--profile` for parity.
  - **Privilege correctness**: ALTER DEFAULT PRIVILEGES routing/elision,
    owner-ACL and revoked-PUBLIC-default convergence, aggregate/FDW grant
    handling.
  - **Object coverage & ordering**: generated columns, domains (incl. NOT VALID
    constraints), publications (PG14 `FOR TABLE`), security labels, extension
    membership, array-of-composite ordering, standalone unique indexes referenced
    by foreign keys.
  - **Secret redaction**: FDW option secrets and required passwords, with
    redaction-mode carried into `apply`/`prove` and a guard against
    snapshot/plan redaction mismatch.
  - **PostgreSQL 14–18** support.

### Minor Changes

- 52cb22a: Attach an attributed projection audit to newly generated plan artifacts. The audit reports raw source-to-desired differences hidden by baseline, policy scope, capability, management-scope, reference-only, or managed-by projection, with stable reason codes and acknowledged/suspicious classification.
- 52cb22a: Canonicalize the extraction session's `search_path` to `pg_catalog` (pg*dump
  convention). Postgres deparsers (`format_type`, `pg_get*\*def`, `pg_get_expr`)
path-relativize names, so any object visible on the session path previously came
back UNQUALIFIED — meaning the same catalog extracted under different search_paths
(e.g. a target database carrying `ALTER DATABASE … SET search_path`, versus a
  freshly-created shadow with the default path) produced DIFFERENT payloads and
  hashes, causing mass false drift in the shadow-vs-target compare and shifting
  routine stable-ids. Extraction now pins the deparse path so identical catalogs
  hash identically regardless of session/database/role path settings, and rendered
  DDL is fully schema-qualified.

  The plan preamble now also pins `search_path` to `pg_catalog` at apply time so
  rendered DDL resolves identically regardless of the applier role's defaults.

  `ENGINE_VERSION` is bumped to `0.2.0` (hash-invalidating): plan artifacts,
  snapshots, and baselines captured before this change must be regenerated.

- 52cb22a: Enum value-set rebuilds now pick a namespace- and length-safe temp name for the old enum: the collision check consults every occupant of the type namespace (enums/composites/ranges, domains, and the implicit row types of tables/views/matviews/foreign tables/sequences), and the generated identifier is clipped to ≤ 63 bytes so PostgreSQL never truncates it back onto an occupied name.

  Table `CREATE`s and schema exports now render columns in DECLARED order instead of alphabetical name order. Column position (`pg_attribute.attnum`) is captured at extract time as a non-semantic field, so a from-empty create/export reproduces the original `SELECT *`, positional-INSERT, and row-type layout; order-only differences on an existing table remain undiffed by design (the field is excluded from the fact hash and diff).

- 52cb22a: Compaction now folds validated PRIMARY KEY / UNIQUE / CHECK constraints on co-created tables into the `CREATE TABLE` parens (`CONSTRAINT name <def>`) in regular diff plans, not just `schema export`. These constraint types are self-contained (they never reference another relation's rows), and the fold runs under the strict no-crossing-edge veto, so apply-executor ordering is unaffected. FOREIGN KEY and exclusion constraints keep their separate `ALTER TABLE … ADD CONSTRAINT` statements.
- 52cb22a: `schema export` now serializes object ownership as `ALTER … OWNER TO` (an assumed
  role reference, consistent with how ACLs already round-trip) instead of dropping
  it at the default `--scope database`. Ownership is suppressed only for the
  resolved DEFAULT owner so exports stay human-readable: the default resolves
  `--default-owner <role|none>` (new flag) > the profile-declared default (Supabase
  → `postgres`) > the database owner (`datdba`). `--default-owner none` emits every
  `OWNER TO` for maximum fidelity.

  Previously, database-scope exports dropped all ownership, so objects owned by a
  non-applier role (e.g. Supabase's `auth_admin`) reloaded applier-owned and then
  showed up as spurious `ALTER … OWNER TO` / `REVOKE … FROM postgres` drift. This
  now holds even when the database has extensions or assumed schemas present: the
  managed view is rebuilt to attach reference-only marks in that case, and the
  rebuild no longer silently re-prunes the retained owner references (which had made
  a real Supabase export emit zero `OWNER TO`).

  The export manifest stamps the resolved default owner (a role name, or `null` for
  a verbose export; a field-absent directory is treated as pre-feature). `schema
apply` reconstructs the identical view and fails closed (exit 2) when the target
  connection role differs from a role-name default. Policy-based owner exclusion is
  unchanged.

- 52cb22a: The shadow loader's post-load DML observation no longer fails a load, and a pre-provisioned isolated shadow is now supported.

  `loadSqlFiles` used to throw `ShadowLoadError` as soon as ANY managed non-extension table held rows after loading the declarative files. That blocked callers whose dedicated shadow is pre-provisioned by a platform — the Supabase CLI boots auth / storage / realtime against its isolated shadow, and those services write their own migration bookkeeping rows (`auth.schema_migrations`, `storage.migrations`, `_realtime.tenants`, …) BEFORE any declarative SQL is loaded. Those rows are not the user's DML and there is nothing the user can do about them.

  Two changes:

  - **Pre-existing rows are exempt.** New loader option `allowPreExistingRows` (default: `true` in `"isolatedCluster"` mode, `false` otherwise; `planSchemaFiles` forwards it and lets the loader default it). When enabled the loader snapshots WHICH managed non-extension tables are already populated before the load and exempts exactly those from the post-load observation — silently, with no diagnostic. The exempted set is returned as `LoadResult.preExistingPopulatedTables`. Exemption is by qualified table name and never compares row contents (the loader deliberately does not diff data), so a table that was already populated stays exempt even if a declarative file inserts into it.
  - **Rows the load DID introduce are a warning, not a failure.** A non-exempt populated table now appends a `data_statement` diagnostic with severity `warning` to `LoadResult.diagnostics` and the load proceeds: pg-delta only ever diffs schema, so incidental data in the shadow cannot corrupt a plan, and refusing to read the schema back would block every directory that carries some. Pass `--strict-data-statements` (loader option `strictDataStatements: true`, `planSchemaFiles` option of the same name) to restore the previous fatal `ShadowLoadError` for CI.

  Extension-owned relations (`pg_depend` deptype `'e'`) remain out of scope, exactly as before.

- 52cb22a: `schema apply` (and the `loadSqlFiles` loader) now treat a USER routine whose body fails the post-load `check_function_bodies = on` re-validation as a loud WARNING instead of a fatal error. Postgres itself accepts such a function under `check_function_bodies = off` — which pg-delta's own apply executor emits in every plan preamble — so refusing to READ back a function pg-delta would happily WRITE was an asymmetry that blocked round-tripping any schema relying on check-off (legacy forward references, tolerated casts, etc.). The warning still flows through the diagnostics output loudly; the load now proceeds and apply faithfully materializes exactly what was declared. Pass `--strict-function-bodies` (loader option `strictFunctionBodies: true`) to restore the fatal gate for CI.

  Seeded/reference-only routine failures are unchanged (still a warning) and now carry the distinct `invalid_seeded_routine_body` code so they can be told apart from user-routine failures. Changing an assumed-schema routine (a new overload, or a `CREATE OR REPLACE` that alters the body of a seeded routine) still fails loud, because assumed-schema facts are reference-only in the diff and such a change would otherwise be a silent no-op.

- 52cb22a: Compaction now merges consecutive same-privilege co-create GRANTs into one grantee-list statement (`GRANT … ON TABLE t TO a, b, c`), matching idiomatic hand-written SQL. Cosmetic by contract: the corpus proves compacted and uncompacted plans converge identically; groups with a surviving REVOKE leader, grant options, column qualifiers, or differing privilege sets are left untouched.
- 52cb22a: Normalize accepted role renames before diffing so OID-carried references do not produce spurious policy, ownership, grant, membership, or user-mapping churn. Reconcile ordinary rename emission with the canonical policy filter so the action list and projected target cannot diverge.
- 52cb22a: Surface the plan's attributed projection audit through every verdict produced by `provePlan` and through the `prove` CLI. Proof output includes complete summary counts and a deterministic, suspicious-first human view capped at 50 entries while preserving baseline and non-baseline acknowledged samples; `--audit-all` prints every entry, and the complete machine audit remains in the `--plan` artifact's `projectionAudit`. The opt-in `--strict-audit` flag evaluates the full audit, fails on suspicious entries, and fails closed when a legacy plan has no audit; every produced verdict exposes whether its audit was available, and artifact summaries are validated and normalized from their entries.
- 52cb22a: feat(pg-delta): publish reusable schema export/plan/render/shadow frontends

  Extract the schema export, plan-from-files, render, and co-located shadow
  orchestration from the private CLI into public `@supabase/pg-delta` /
  `@supabase/pg-delta/frontends` APIs (`buildSchemaExport`, `planSchemaFiles`,
  `renderPlanFiles`, `provisionCoLocatedShadow`, export manifest helpers, and
  `ManagementScope`). The `pgdelta` CLI now calls these functions so there is a
  single implementation for library and CLI consumers.

- 52cb22a: Add statement-level debugging for `schema apply`: `--dry-run` prints a portable SQL apply script (including transaction framing, full per-segment preambles, and cleanup) to stdout without applying anything or running the fingerprint gate. The script records its execution contract in comments: dispatch statements in order on one session, stop at the first error, and preserve autocommit outside explicit transaction blocks; do not send it as one multi-statement request or wrap it in one global transaction. `--verbose` streams a segment/action progress trace to stderr as the real apply runs, including every non-action statement actually sent on the connection (`BEGIN`, preamble `SET`/`SET LOCAL`, `COMMIT`, `ROLLBACK`, `RESET ALL`) since the applied statements are planner-rendered atomic DDL, not the authored declarative SQL; `--out-plan <plan.json>` archives the plan artifact right after planning. When secret redaction is disabled by either the flag or export manifest, every output surface that may reveal credentials emits an explicit warning. The library `apply()` gains a corresponding optional `onEvent` observer (`ApplyEvent`: `segmentStart`/`actionStart`/`actionEnd`/`segmentEnd`/`control`) that any caller can hook into — purely additive, a throwing observer never changes apply's control flow, action statuses, or report. Apply failures identify the exact action or executor control statement that failed, keep setup failures unapplied, preserve successful non-transactional actions when session cleanup fails, and discard connections whose cleanup could not be verified.
- 52cb22a: Add a `partitionOf` predicate to the Policy DSL: matches declarative partition
  children (`pg_class.relispartition`), optionally pinned to a parent table by
  schema/name glob. `{ partitionOf: {} }` is the drop-in replacement for the old
  filter DSL's `table/is_partition: true`; the pinned form
  (`{ partitionOf: { schema: "realtime", name: "messages" } }`) is preferred —
  it states whose partitions are operational churn instead of hiding every
  partition, and the projection audit classifies it as a named-object selector.

### Patch Changes

- 52cb22a: Canonicalize the grantor's own default-privilege self-entry at extraction so `pg_default_acl` rows round-trip. For a PER-SCHEMA row, one built by explicit grants to the owner (`{owner=arwdDxtm/owner, other=…}`) and one built purely from grants to other roles (`{other=…}`, no owner entry) are behaviorally identical — Postgres re-adds the owner's `acldefault` entry to every new object at creation time regardless of the stored row. Previously the extractor emitted a spurious `revoked_default` marker for the owner whenever it was absent from the stored ACL, so re-exporting a replayed database produced a spurious `alter default privileges … revoke all … from <owner>` self-revoke. The owner's own revoked-default marker is now suppressed where its absence is a behavioral no-op (PUBLIC and other-role markers are unaffected; a partial owner self-reduction that differs from `acldefault` is still represented as a positive fact; a GLOBAL row where the owner's absence is a real revoke keeps its marker — see the companion global-self-revoke changeset).
- 52cb22a: Extract a GLOBAL (cluster-wide) default-privilege owner self-revoke as a real `revoked_default` marker instead of silently dropping it. The previous canonicalization suppressed the grantor's own revoked-default marker unconditionally, which is only correct for per-schema rows (Postgres always re-merges the owner's `acldefault` entry at object creation) and for a bare global self-revoke with an empty stored ACL (the created object's relacl degenerates to NULL and the owner keeps its privileges). On a GLOBAL row that still carries other grantees (e.g. `alter default privileges for role alice revoke all on tables from alice; ... grant select on tables to bob` → `{bob=r/alice}`), Postgres uses the stored ACL verbatim at creation, so the owner really loses its own privileges — a genuine customization that must survive export/apply/reverse. The suppression is now conditional (per-schema and bare-empty-global stay no-ops; global-with-other-grantees emits the owner marker so the `revoke`/`grant` round-trips).
- 52cb22a: Several correctness and packaging fixes:

  - **Ordered-set aggregate metadata**: `COMMENT ON` / `SECURITY LABEL ON` an ordered-set or hypothetical-set aggregate now address it with the `agg(direct ORDER BY ordered)` signature (reusing the aggregate DDL's `aggSig`), instead of the flat argument list that PostgreSQL rejects at apply.
  - **`render` prunes stale segments**: re-rendering a plan to the same `--out` base now deletes the previous render's segment files (`<base>.sql` / `<base>_<n>.sql`) that the new render no longer produces, so a runner scanning the directory can no longer replay obsolete (possibly destructive) segments. Only render-owned files matching that naming scheme are touched; foreign files are left in place.
  - **`--strict-coverage` blocks unresolved security labels**: a valid `SECURITY LABEL` on an unsupported object (language / database / large object / tablespace) now escalates to a blocking diagnostic under `--strict-coverage`, matching `unmodeled_kind`, instead of silently producing an artifact that omits the label.
  - **Enum value-set rebuild guard**: removing or reordering enum values while a non-column dependent (a `DOMAIN` over the enum, a `COMPOSITE` attribute using it, or a `RANGE` over it) survives now fails loudly at plan time. The rebuild only migrates column dependents, so such objects would otherwise leave the final `DROP TYPE` failing at apply. Full migration of non-column dependents remains out of scope.
  - **ESM-only packaging**: removed the misleading `require` conditions from every `exports` entry. The package is `type: module` with a NodeNext build and ships no CommonJS output, so a `require` condition pointing at ESM was a false CJS signal (`ERR_REQUIRE_ESM` on Node <22). CommonJS consumers must use dynamic `import()`, or Node >=22 (which can `require()` ESM synchronously). ESM consumers are unaffected.

- 52cb22a: `schema apply` now (1) fails closed when an explicit `--shadow`'s connection role differs from the export's stamped default owner — the shadow would otherwise load omitted-`OWNER TO` objects as its own role and plan spurious ownership drift — and (2) treats a directory with no manifest default-owner record as verbose, honoring every explicit `OWNER TO` in the files instead of synthesizing a target default and pruning owner edges to it (which silently dropped an explicit owner change when the target object was owned by a different role).
- 52cb22a: Prevent assumed-schema shadow seeding from replaying reference-only objects before their managed dependencies exist.
- 52cb22a: Preserve composite type attribute order. The composite `CREATE TYPE … AS (…)` rule assembled attributes in encoded-id (name) order, silently reordering columns (e.g. `errors` before `wal`) on every reconstruction — a row-layout change that broke composite-returning dependents at body validation. The extractor now carries the declared attribute position (as the non-semantic `_position` payload key, excluded from hash/diff), and the composite create renders attributes in that order.
- 52cb22a: The `concurrentIndexes` serialize option no longer inserts `CONCURRENTLY` for
  indexes on partitioned tables. PostgreSQL rejects `CREATE INDEX CONCURRENTLY`
  on a partitioned table's parent index (relkind `p`), so such a plan failed at
  apply time. Those indexes are now created plainly (transactionally) while
  indexes on regular tables keep the concurrent, non-transactional path.
- 52cb22a: Plans (and therefore rendered migration files) only carry
  `check_function_bodies = off` in their session preamble when the plan actually
  touches a routine-family object — a function, procedure, aggregate, extension,
  or extension intent, directly or through a satellite (comment / grant /
  security label). A migration that only touches tables, columns, indexes,
  grants, or triggers (`CREATE TRIGGER` never validates its function's body) no
  longer starts with a `set local check_function_bodies = off;` it cannot need.

  The predicate deliberately errs toward keeping the entry, and the omission is
  part of the cosmetic compaction contract: planning with `compact: false`
  restores the unconditional preamble.

- 52cb22a: `loadSqlFiles` enables `createrole_self_grant` on PG 16+ so a CREATEROLE non-superuser (Supabase `postgres`) can load `CREATE SCHEMA … AUTHORIZATION new_role`, and strips the resulting bootstrap memberships from the extracted fact base so plans do not emit a failing `GRANT … TO <applier> WITH ADMIN OPTION`. Assumed-schema seeding uses the same GUC on a dedicated pool client.
- 52cb22a: Fix role drop to no longer emit `DROP OWNED BY <role>` ahead of `DROP ROLE <role>`.
  `DROP OWNED BY` swept up anything the role owned outside the managed/projected
  view (objects the engine never extracted), silently destroying unmanaged data
  when applying the plan. Managed grants, default ACLs, and owned objects are
  already revoked/reassigned/dropped by their own plan actions before the role
  drop runs, so a plain `DROP ROLE` succeeds when everything is managed, and now
  Postgres fails loud ("role cannot be dropped because some objects depend on
  it") instead of silently destroying data when unmanaged ownership remains.
- 52cb22a: `schema apply` no longer corrupts `COMMENT ON TRIGGER`/`COMMENT ON POLICY` statements containing non-ASCII text during shadow-load reordering. The underlying fix lands in `@supabase/pg-topo` (statements are now sliced by UTF-8 byte offsets and carried verbatim); pg-delta picks it up through its optional peer range and adds regression coverage across the reorder → shadow-load path. Reordered error locations (`file:line:col`) are also exact after non-ASCII content, since `sourceOffset` is now a character offset.
- 52cb22a: Fix `schema export` folding a table constraint inline into `CREATE TABLE` when the column it references was deferred to a later `ALTER TABLE … ADD COLUMN` (a domain-typed column whose fold crosses the domain-create edge, or a generated column that never hints). The constraint fold pass bypassed the crossing guard for all constraints (to keep validated FKs to later-created tables foldable), which produced `CREATE TABLE … CONSTRAINT … UNIQUE (slug)` where `slug` was not yet a column, so the export failed to reload with `column "slug" named in key does not exist`. The guard now vetoes a constraint fold only when a same-table column of the fold target is deferred, while still tolerating crossings to other relations (an FK's referenced table, backing indexes/types elsewhere). Such constraints now render as standalone `ALTER TABLE … ADD CONSTRAINT`.
- 52cb22a: `schema export` now emits `SEQUENCE NAME` for identity columns whose implicit
  backing sequence name differs from the `<table>_<column>_seq` default (renamed
  sequences, or ones created via `SEQUENCE NAME`). Previously the export rendered
  a bare `GENERATED … AS IDENTITY`, so reload let PostgreSQL re-derive the default
  name and the next diff produced a spurious `ALTER SEQUENCE … RENAME`. Renamed
  identity sequences now round-trip cleanly; default-named identity columns stay
  bare so ordinary exports remain minimal.
- 52cb22a: Disable JIT for extraction's catalog queries. `EXPLAIN (ANALYZE)` on the `pg_depend` dependency-resolver query showed an inflated cost estimate crossing Postgres's default `jit_above_cost`, JIT-compiling ~467 functions per run for ~59% of a warm execution — pure per-execution overhead, since catalog-only queries gain nothing from JIT. Extraction now pins `SET LOCAL jit = off` for its transaction.
- 52cb22a: Fix dependency-cycle planning when an accepted role rename is referenced by an RLS policy.
- 52cb22a: Fix policy hard-exclusion laundering an excluded owner role back into the plan.
  `excludeFactsAndDescendants` no longer mints a dangling `owner -> role` edge for
  a role that THIS exclusion removes (it only preserves edges that were already
  dangling on input, the seed-rebuild case). Previously a policy-excluded role
  retained its owner edge, was auto-assumed in `plan.ts`, and re-emerged as
  `CREATE SCHEMA … AUTHORIZATION <role>` / `OWNER TO <role>` while silencing the
  missing-requirement guard. Now the guard correctly fires when a kept object's
  ACL (or ownership) references a policy-excluded role. Also fixes the
  "typo'd function body is caught by re-validation" test to opt into
  `strictFunctionBodies` (a user-routine body-lint is a warning by default under
  lenient function bodies).
- 52cb22a: Fix five round-trip fidelity gaps in the planner:

  - Multi-level partitions keep their own `PARTITION BY` clause, so a partition that is itself partitioned can have sub-partitions attached.
  - Removing a foreign server `VERSION` (which has no `ALTER SERVER` grammar) now routes to a drop + recreate instead of crashing planning.
  - `ALTER EXTENSION … SET SCHEMA` is no longer emitted for non-relocatable extensions; relocation is planned as a drop + recreate in the new schema.
  - Zero-argument aggregate `COMMENT` / `SECURITY LABEL` targets render `name(*)` instead of the invalid `name()`.
  - Replacing a foreign server that has dependent foreign tables / user mappings now drops and recreates those children around the replace (the parent `DROP SERVER` does not cascade), instead of failing on the surviving dependents.

- 52cb22a: The SQL formatter now wraps long `GRANT`/`REVOKE` statements at clause boundaries (privileges, `ON <target>`, `TO`/`FROM <grantees>`) instead of the generic first-comma wrap that put one privilege per line. Short statements keep their single line.
- 52cb22a: Fix unappliable plans when an identity or generated column changes type (e.g.
  widening `integer GENERATED ALWAYS AS IDENTITY` to `bigint`). The leading
  `ALTER COLUMN … DROP DEFAULT` is now skipped for such columns (PostgreSQL
  rejects it outright), and the `USING` cast is dropped for generated columns
  (also rejected).

  The `DROP DEFAULT` gate reads the _desired_ identity state, not the source one:
  identity add/drop deltas order before the type change, so a plain column that
  gains identity in the same plan is already an identity column by then and the
  `DROP DEFAULT` was rejected.

  An identity column's sequence bounds are also positioned relative to the `TYPE`
  change by direction. Widening emits them _after_ it (the desired bounds need not
  fit the old type). Narrowing emits them _before_ it, because an explicit bound
  that overflows the new type made the retype itself fail (`MAXVALUE (5000000000)
is out of range for sequence data type integer`).

- 52cb22a: Make in-place `ALTER` actions participate in the plan's dependency walk by declaring `consumes`/`releases` on four rule sites, so they no longer sort before the `CREATE` of a new dependency or after the `DROP` of an old one. Column `TYPE …` changes now consume the new column type and release the old one; `ALTER EXTENSION … SET SCHEMA` releases the old schema; sequence `OWNED BY` reassignment releases the old owning column; and `ALTER POLICY … TO` consumes newly-listed roles and releases removed roles. Previously each of these could be emitted against a not-yet-created target ("type/relation/policy does not exist") or block a same-plan `DROP` of the object it stopped referencing.
- 52cb22a: Three planning fixes from issue #333: (1) a domain whose `baseType`/`collation` change is a drop+recreate — the planner now fails loud at plan time (instead of emitting a plan Postgres rejects at apply) when a surviving table column still depends on the domain, mirroring the existing in-use range-type guard. (2) An enum value-set rebuild (removal/reorder) migrated every dependent column with a scalar `col::text::<enum>` cast regardless of the column's own declared type; an `enum[]` column now casts correctly (`TYPE <enum>[] USING col::text[]::<enum>[]`) instead of erroring or silently narrowing to scalar. (3) A constraint's `validated` attribute going from `true` to `false` (VALIDATED → NOT VALID) threw `constraint cannot be de-validated in place` instead of planning a fix; it now replaces the constraint (`DROP CONSTRAINT` + `ADD CONSTRAINT … NOT VALID`), matching how `create()` already renders a fresh NOT VALID constraint.
- 52cb22a: Three fixes to the SQL loader, snapshot metadata, and baseline subtraction:

  - **Loader:** `CREATE|ALTER|DROP USER MAPPING …` statements are no longer misclassified as cluster-global role DDL. The role-lifecycle scanners now use a `user(?!\s+mapping)` negative lookahead, so database-scope `schema apply` accepts (and `--skip-cluster-ddl` no longer strips) the user mappings pg-delta itself emits in foreign-data exports.
  - **Snapshots:** `pgdelta snapshot` now stamps the profile it was captured under (a declared id, `null` for a raw capture, or absent for pre-feature legacy snapshots — never folded into the digest). `drift` and `prove` reconcile that stamp against any `--profile` flag: an omitted flag adopts the stamped profile, a contradicting flag fails closed with an actionable error, and a legacy (un-stamped) snapshot keeps the previous behavior with a one-line note.
  - **Baseline subtraction:** `subtractBaseline` now compares each fact's outgoing-edge signature alongside its payload hash, so an equal-payload fact whose ownership/provenance edge changed (e.g. `OWNER` A→B) is no longer subtracted and pruned away invisibly. Owner→role edges to subtracted platform roles are retained as dangling assumed references so ownership still serializes.

- 52cb22a: fix: the supabase profile no longer exports platform role plumbing under cluster scope (#371). The `supabase_privileged_role` role object and its grant to `postgres` join the system-role exclusions, and the `postgres` role object itself (NOSUPERUSER attributes + platform `search_path` config) is projected out of the managed view — none of it is user-declared state, and none of it can be re-applied by the non-superuser `postgres`. User roles, and grants where `postgres` is merely a member, still round-trip.
- 52cb22a: Speed up diffing and planning on very large catalogs by memoizing content hashing and trimming fact-base construction overhead.

  Every fact-base REBUILD (managed-view reconstruction, baseline subtraction, scope/target projection, identity normalization) re-hashed every payload from scratch, so a single diff+plan on a million-object catalog spent most of its time computing the same few thousand SHA-256 digests millions of times. Content hashes are now memoized — by payload object (skipping canonical encoding entirely on a rebuild) and by canonical encoding (the real equality surface), with the string cache bounded so a long-lived process cannot accumulate. Fact-base construction also reuses the encoded parent key and pre-encoded edge endpoints instead of re-encoding stable ids on every hierarchy walk and rollup.

  Digest output is unchanged — same hashes, same plans, same SQL. On a 433k-fact catalog: fact-base build 1.6s → 1.3s (0.7s for a rebuild), cold diff 1.36s → 0.98s, cold plan 3.7s → 2.7s, and peak heap roughly halved.

- 52cb22a: Fix `extract()` failing with `permission denied for table pg_user_mapping` when connecting as a non-superuser: user mappings now fall back to the world-readable `pg_user_mappings` view (with a warning diagnostic, since the view hides options the role isn't authorized on). Mappings whose options the view hides from the current role are skipped with that diagnostic instead of being recorded with fabricated empty options. `plan()` now refuses to plan changes touching a user mapping whose state was unreadable (and therefore unknown) on either side, instead of silently emitting a wrong CREATE/DROP USER MAPPING.

  The unreadable-user-mapping diagnostic now survives extension-handler profiles (e.g. Supabase) instead of being silently dropped by the handler-triggered fact-base rebuild. Snapshots now carry `FactBase.diagnostics` (excluded from the digest), so the `plan()` gate still fires when one side is a deserialized snapshot rather than a live extraction; old snapshots without this field simply remain ungated, same as before. The gate itself now also refuses a `DROP SERVER` or `DROP ROLE` that would implicitly destroy a hidden mapping, not just a direct change to the mapping itself.

  `pgdelta drift` now surfaces diagnostics carried by the snapshot side; the plan gate also covers replace-class server changes (`server.type`/`server.fdw`, which have no in-place ALTER and would otherwise silently drop-and-recreate the server, destroying an unreadable mapping's server, instead of throwing).

  `pgdelta prove` now surfaces diagnostics carried by the desired snapshot and annotates a passing proof with their count.

- 52cb22a: Fix five non-superuser / library-caller correctness gaps (issue #333, items 13-17):

  - Role security-label extraction joined `pg_authid` (superuser-only); it now joins `pg_roles`, so a non-superuser caller no longer hits `permission denied for table pg_authid` when a role security label exists.
  - Subscription extraction selected `pg_subscription.subconninfo` unconditionally; that column is revoked from non-superusers by default (unlike every other column on the table), so the whole query failed for such a caller. The column is now probed with `has_column_privilege` and conditionally included in the query text (a runtime `CASE WHEN` guard does not work — Postgres's column permission check is static and fires on any reference to the column, not on which branch runs); when unreadable, the fact falls back to the existing `SUBSCRIPTION_CONNINFO_PLACEHOLDER`.
  - A user mapping whose foreign server was added to an extension (`ALTER EXTENSION … ADD SERVER …`) orphaned `buildFactBase` with a missing-parent error, because the user-mapping query lacked the extension-member anti-join the server query already has. It is now excluded consistently with its server.
  - `apply()`'s and `provePlan()`'s fingerprint/proof re-extraction ignored `Plan.redactSecrets`, always re-extracting the target with the default (redacted) mode. A plan built from `extract({ redactSecrets: false })` was therefore spuriously rejected (or reported as drifted) even with zero actual delta. Both now honor the plan's stamped redaction mode when no custom `reextract` is supplied.
  - `ALTER DEFAULT PRIVILEGES ... ON LARGE OBJECTS` (PG18+) was rendered as `ON TABLES` (the `DEFACL_OBJTYPE` map had no `L` entry and silently fell back); an unmapped `defaclobjtype` now also fails loudly instead of guessing.

- 52cb22a: Make the co-located shadow seed (`schema apply --profile supabase` without `--shadow`) replayable by non-superuser roles. Real Supabase Cloud gives users a privileged NON-superuser `postgres`, so the assumed-schema seed previously failed at the seed step. The seed now omits (never rewrites) the two fact classes a non-superuser cannot replay: a routine whose `proconfig` SETs a superuser-only GUC (detected from structured catalog data, context-driven — e.g. `SET log_min_messages`, never `search_path`) is skipped whole along with anything depending on it (transitively, including the contained children — e.g. columns — of any excluded container object), and platform default-privilege entries (`ALTER DEFAULT PRIVILEGES FOR ROLE …`) are omitted. Both are inert to omit: a seeded object re-extracts reference-only and cancels in the diff, so its absence is symmetric, and a default-privilege entry has no possible dependents.
- 52cb22a: fix(pg-delta): merge case-colliding schema export paths into one shared file

  PostgreSQL identifiers are case-sensitive, but the default filesystems on
  macOS (APFS) and Windows (NTFS) are not: case-twin objects (`"Users"` vs
  `"users"`) exported to paths differing only by case landed in one physical
  file, the second write silently overwrote the first, and `schema apply` from
  that directory wedged on the missing object's dependents. `schema export` now
  folds every case-colliding path segment to a canonical spelling — the
  lexicographically smallest spelling actually present — on every platform, so
  an export written on Linux still checks out cleanly on a Mac: case-twin files
  merge into one shared file holding every twin's DDL in plan order, and
  descendants of case-twin directories agree on the parent's casing. Dependency
  cycles that only exist at the merged-file grain are handled so the loader
  still converges: foreign keys route to the `.fk.sql` post-data split, and
  unsplittable cycles (case-twin views around an interposed view) collapse into
  one file.

  Identifiers containing dots now percent-encode them in export file names
  (a table `"Foo.fk"` exports as `Foo%2Efk.sql`), so an identifier can never
  spoof the reserved `.sql` / `.fk.sql` suffixes; over-long encoded names clamp
  deterministically under the 255-byte filename limit. A lone spelling is never
  rewritten, non-colliding paths are unchanged, and each merge is reported as
  an export warning.

- 52cb22a: `extract()` now detects `pg_parameter_acl` (PG 15+, backs `GRANT SET ON PARAMETER` / `GRANT ALTER SYSTEM ON PARAMETER`) and surfaces it as an `unmodeled_kind` diagnostic instead of silently missing it. The probe is version-gated and stays a clean no-op on PG 14.
- 52cb22a: The stable-id parser now accepts column-qualified ACL ids
  (`acl:(table:...).grantee.column`), which the encoder produces for
  column-level grants. Snapshots and baselines that contain column-level grants
  now load correctly in `drift`/`prove` instead of failing with a
  "trailing input" parse error.
- 52cb22a: Elide the default-owner username when replaying a pg_cron job, so a plan containing cron intent is applyable by a non-superuser executor.

  pg_cron requires SUPERUSER for any non-NULL `username` argument to
  `cron.schedule_in_database(...)` — even when it names the calling role itself
  (`ERROR: must be superuser to create a job for another role`). A bare `NULL`
  means `current_user` and needs no privilege. Because pg-delta always rendered
  an explicit username literal, every plan or export containing a pg_cron job
  was unapplyable as the `postgres` role a hosted Supabase project hands out.

  The pg_cron handler is now a factory, `makePgCronHandler({ defaultJobOwner,
jobOwnerAliases })`, so the file carries no platform-specific role names; the
  Supabase profile constructs it with `defaultJobOwner:
supabasePolicy.defaultOwner` and the CLI-1435 `supabase_read_only_user →
postgres` alias. A job owned by the profile's default job owner replays with
  `NULL`; a job owned by a third role keeps the explicit literal (it genuinely
  requires a superuser executor) and now raises a new `intent-privileged`
  warning diagnostic at capture — warn and emit, never silently drop.

  A custom profile file (`--profile ./my-profile.json`) gets the same treatment:
  its `handlers: ["pg_cron"]` entry is built from the file's OWN
  `policy.defaultOwner`, so a profile that declares an owner/executor role also
  gets the elision. Only profiles with no declared default owner (`raw`, and
  profile files without `policy.defaultOwner`) keep the explicit rendering.

- 52cb22a: Four PR-review fidelity/correctness fixes:

  - **Range type in-use replacement guard.** Changing a range type's attributes
    (`subtype`, `subtype_opclass`, …) is a drop+create. When a surviving table
    column still uses the type, PostgreSQL rejects the `DROP TYPE` at apply time;
    the planner now fails loud at plan time with an actionable message instead of
    emitting a plan that crashes on apply (mirrors the in-use composite
    `ALTER ATTRIBUTE` guard).
  - **Rewrite-rule enabled state on create.** A freshly created rule always lands
    enabled; the create path now appends the follow-up
    `ALTER TABLE … {DISABLE | ENABLE REPLICA | ENABLE ALWAYS} RULE …` when the
    desired rule is not origin-enabled, so a disabled/replica/always rule
    converges (its `ev_enabled` is hashed).
  - **Deterministic inheritance-parent extraction.** The single captured
    `parentTable` for a multiple-inheritance table now sorts the `pg_inherits`
    subquery by `inhseqno`, so the first-declared parent is captured
    deterministically and no longer flaps the fact hash across extractions.
  - **Column-level grant extraction/render.** `pg_attribute.attacl`
    (`GRANT SELECT (col) ON t TO r`) is now extracted and rendered as
    column-qualified GRANT/REVOKE actions, so a from-empty export no longer
    silently drops column privileges and schemas differing only by column grants
    no longer hash equal.

- 52cb22a: fix(pg-delta): `pgdelta --version` (and `-v`/`version`) now prints the package version instead of "Unknown command", and `pgdelta schema --help` (and `-h`/`help`) prints the schema subcommand usage to stdout and exits 0 instead of erroring with "Unknown schema subcommand".
- 52cb22a: Ship `COVERAGE.md` and `MIGRATION.md` in the published package, and rewrite the
  package README for users: drop the internal stage-coverage section and the
  dangling `PORTING.md` reference, correct the corpus scenario count, and remove
  the claim that the benchmark harness runs in CI.
- 52cb22a: Speed up planning on very large catalogs by computing the managed-view projection once per plan and removing several superlinear hot spots.

  `plan()` reconstructed the managed view of both sides twice — once to build the change set, once again to attribute the projection audit — and the audit then ran a third full diff even when nothing had been suppressed. The change set now collects projection suppressions as it reconstructs, the audit is attributed from those records, and it short-circuits when the projection hid nothing. `resolveView` also returns the input by reference immediately when there is no policy, capability or baseline and no extension-member/managed-by provenance, instead of proving that with three full passes over the fact base.

  Four scaling fixes on top: the action graph's teardown ordering uses the fact base's reverse edge index instead of rescanning every edge per destroyed id; the projected-target orphan sweep is a reverse-BFS from the removed set instead of a whole-base rescan per fixpoint round; the delta sort computes each sort key once instead of once per comparison; and the projection removal walk memoizes negative answers, so a deep hierarchy no longer re-walks and re-encodes every ancestor chain.

  No behavior change — the deltas, plan actions and SQL are byte-identical. On a 433k-fact catalog the cold plan drops 2.6s → 1.4s; on the 180k-fact stress fixture the plan phase drops 627ms → 226ms.

- 52cb22a: perf: probe the server version once per extraction instead of five times, trimming redundant round trips.
- 52cb22a: prove: per-table autoSeed outcome reporting (seeded/skipped/failed) surfaced in the proof verdict. `provePlan({ autoSeed: true })` no longer swallows insert failures — each empty kept table now reports `seeded`, `skipped`, or `failed` on `ProofVerdict.seedOutcomes`. A `skipped` is either an expected class-23 integrity-constraint violation (the SQLSTATE as `reasonCode`) or the synthetic `no_row` code, meaning the `DEFAULT VALUES` insert resolved but a trigger/rule left the row absent from the final pre-apply snapshot (persistence is judged by reconciling provisional seeds against that one snapshot, since the command tag / rowCount can lie — even a later table's trigger can undo an earlier seed). Anything else is a `failed` with its message, so a genuinely-unseedable table is no longer confused with one that failed for a reason nobody saw. Data that was already present remains anchored to the pre-seed snapshot, and populated kept tables are compared immediately after seeding, preventing trigger side effects from synthetic inserts from being silently accepted or hidden by a later schema change. After seeding, the complete extracted managed-state fingerprint must still match the plan source, catching trigger DDL outside the column signature such as RLS, replica identity, reloptions, constraints, and other modeled facts. Seed safety failures are surfaced separately so an `EXPECTED_RED` corpus pin cannot swallow them. The concurrent corpus runner also treats reverse-direction seed files containing cluster-global role DDL as serial work. The corpus gate rejects stale skip exemptions that are no longer observed.
- 52cb22a: Fix a false-positive `unmodeled_kind` warning for the range→multirange cast that `CREATE TYPE ... AS RANGE` auto-creates. Unmodeled-kind detection now excludes objects registered as `pg_depend`-internal (`deptype = 'i'`) to another object, since such objects are created and dropped alongside their owner and can never be independently managed DDL — the owner's own fact already covers their lifecycle. Explicit user-authored objects (e.g. a hand-written `CREATE CAST`) are unaffected and still warn.
- 52cb22a: fix(pg-delta): scope shadow-load body validation to sql/plpgsql routines

  `loadSqlFiles`'s post-load body-validation pass re-ran every non-extension-member routine's definition with `check_function_bodies = on`, regardless of language. `check_function_bodies` only validates `sql`/`plpgsql` bodies — Postgres never checks other languages — so re-running an `internal`/`c` routine added no coverage and could break the load outright: `CREATE TYPE ... AS RANGE (...)` auto-creates `LANGUAGE internal` constructor/support functions, and re-running those as a non-superuser role (the production-faithful Supabase case) fails with `permission denied for language internal`. The validation query now filters to `sql`/`plpgsql` routines.

- 52cb22a: Role-rename carry now preserves the `column` field (and all other id fields) when relabeling ACL ids, so a pure role rename involving a COLUMN-level grant (`GRANT SELECT (col) ON t TO r`) no longer emits a spurious REVOKE/GRANT pair around the rename. PostgreSQL carries the column grant across the rename by OID; the planner no longer re-issues DDL that would also require table-grant privileges a rename-only migration should not need.
- 52cb22a: Rendered migration files no longer pin `search_path` in their preamble. The
  rendered DDL is already fully schema-qualified, so the pin was redundant — and
  it broke third-party migration runners such as dbmate, which append their own
  unqualified bookkeeping (`INSERT INTO schema_migrations ...`) inside the same
  transaction as the migration file; a pinned `search_path = pg_catalog` resolved
  that insert to `pg_catalog.schema_migrations` (which does not exist) and failed
  the migration. `check_function_bodies = off` is still emitted, and `apply()`
  keeps pinning `search_path` on its own dedicated connection.
- 52cb22a: Three safety/reporting fixes:

  - **Rendered migration files restore session settings.** `render` (both the
    multi-file `renderPlanFiles` and the single-file `renderPlanSql`) previously
    emitted the plan preamble (`search_path = pg_catalog`,
    `check_function_bodies = off`) as plain session-level `SET`s with no restore,
    so a reused runner session (sequential migration runners) silently inherited
    them. It now mirrors `apply()`: `SET LOCAL` inside transactional files (reverts
    at COMMIT) and plain `SET` + a trailing `RESET` for non-transactional
    files/scripts.
  - **`prove` no longer over-claims data preservation.** After a passing proof,
    the "data preservation verified" line is now qualified with honest coverage
    when tables were only count-verified (schema changed) or not compared
    (recreated/dropped), naming the affected tables. `ok`/exit semantics are
    unchanged — reporting honesty only.
  - **`DROP EXTENSION` is flagged destructive when it owns data.** A dropped
    extension that owns a data-bearing persisted member (table / materialized
    view) now carries `dataLoss: "destructive"`, derived from the member closure;
    an extension whose members are only functions/types stays non-destructive.
    Previously every extension drop defaulted to non-destructive because its
    members are projected out of the diff.

- 52cb22a: Require `@supabase/pg-topo@^1.0.0-alpha.3` (was `^1.0.0-alpha.2`). `schema apply`'s reorder assist now relies on pg-topo alpha.3's total-order behavior, where cycle members remain in the `ordered` output so pg-delta fails loudly instead of silently loading a partial schema (alpha.2's behavior). A consumer with only alpha.2 installed satisfied the old range but could hit the silent-omission path.
- 52cb22a: Three correctness fixes to schema diffing:

  - **Sequence/identity `RESTART` only on disjoint ranges.** A combined
    `ALTER SEQUENCE` / `ALTER COLUMN … SET` that moved a bound and the START
    together appended `RESTART` unconditionally, resetting the live counter even
    when the new range still contained it (e.g. a sequence at 500 with
    `MINVALUE 1→0` + `START 1→2`) — replaying already-issued values and risking
    duplicate keys. `RESTART` is now emitted only when the old and new ranges are
    provably DISJOINT (the counter is then guaranteed invalid); an overlapping
    change leaves the unmodeled runtime counter alone, and if it happens to fall
    outside the new range PostgreSQL rejects the ALTER loudly rather than silently
    resetting.

  - **Security labels on unmodeled `pg_type` kinds no longer mis-resolve.** The
    `pg_type` label resolver mapped every non-domain row to a `type` fact, but
    extraction only models enums, standalone composites, and ranges. A label on a
    base type, shell type, or a table's row type therefore attached to a
    nonexistent parent (dropped as an `orphaned_satellite` at severity `info`,
    slipping past `--strict-coverage`). Such labels now fall through to the
    `unresolved_security_label` diagnostic like other unmanaged targets.

  - **Invalid indexes no longer converge against valid ones.** A failed or
    cancelled `CREATE INDEX CONCURRENTLY` leaves `indisvalid=false` with a def
    identical to the desired valid index, so the unusable index hashed EQUAL and
    planning saw zero drift. `indisvalid` is now a semantic payload field, so an
    invalid regular index differs from a valid one and is repaired via drop +
    recreate. Partitioned parent indexes (relkind `'I'`) are forced valid because
    their `indisvalid` tracks unmodeled child attach-state (#332), not corruption.

- 52cb22a: Five safety fixes across the plan, proof, and SQL-file frontends:

  - **Composite `DROP ATTRIBUTE` is now marked destructive.** `ALTER TYPE … DROP ATTRIBUTE … CASCADE` nulls the stored value of that field across every row of every table using the composite, but carried no `dataLoss` flag, so the safety report called it non-destructive and the renderer (which gates on `dataLoss`) emitted it silently. The proof loop cannot catch this because a composite attribute change folds into the table's schema signature and degrades the content check to count-only. The drop spec now declares `dataLoss: "destructive"`, which also covers the collation-only attribute change that routes through the attribute "replace" (drop + recreate) strategy.
  - **Role-membership revoke no longer emits `CASCADE`.** On PG16+, revoking an `ADMIN OPTION` membership with `CASCADE` also deleted downstream `pg_auth_members` rows the member had granted onward — including grants present on both diff sides that were meant to be kept — and extraction is grantor-blind, so nothing planned a corrective re-grant. The drop now emits a plain `REVOKE`; on PG16+ with a dependent grant it fails loudly ("dependent privileges exist") instead of silently destroying the kept grant (convergent regrant is tracked separately).
  - **Declarative export prune only deletes files it owns.** The export manifest now records the list of files it wrote (`files`). Re-exporting prunes only paths the previous manifest owned; unrecognized `.sql` files (hand-authored, or a pre-feature directory) are refused with a hard error naming them rather than silently deleted, and a new `--prune-unmanaged` flag restores delete behavior.
  - **Scratch-mode shadow loads contain cluster-object leaks.** In `databaseScratch` mode, `loadSqlFiles` now preflights every file for cluster-global DDL (roles/memberships) before executing anything, and runs a best-effort restore (drop created roles, invert membership deltas) on all exit paths — including error paths that previously skipped the leak check — so a committed `CREATE ROLE` or a DO-block dynamic role no longer survives a failed load.
  - **The proof loop now covers renamed tables.** Accepted table renames are stamped on the plan artifact; the proof maps the old table to its new name so its row count and (when the schema signature is unchanged) content fingerprint are verified as CHECKED, instead of being skipped as recreated and left with zero data-preservation coverage.

- 52cb22a: CLI commands are now embedder-safe: command handlers (`schema apply`, `apply`, `drift`, `render`, `prove`, …) and the shared frontends/diagnostics helpers no longer call `process.exit` themselves. They throw instead (`UsageError` / `SchemaFrontendError` → exit 2, or `CliExit(code)` for operation-result exits), and `main()` is the sole exiter mapping those to the same CLI exit codes as before. Previously a guard such as the `schema apply` baseline-mismatch / pg_cron precheck aborted the host process mid-run when the command was invoked in-process (library use, tests), tearing everything down; those errors now propagate to the caller.

  Extraction no longer emits owner edges to built-in (`pg_`-prefixed) roles such as `pg_database_owner` (the owner of the `public` schema). Those edges were always pruned as dangling, so the fact base is unchanged — this only removes the recurring `WARNING [dangling_edge] role:pg_database_owner` noise.

- 52cb22a: Fix `schema apply` leaking its co-located shadow database when the default-owner
  guard rejects a divergent applier. The guard's `process.exit(2)` fired before the
  `finally` that drops the throwaway shadow, so a `pgdelta_shadow_*` database was
  left behind on the target's cluster. The shadow is now released (respecting
  `--keep-shadow`) before the guard exits, and the same cleanup runs on the
  apply-failure exit path.
- 52cb22a: Fix `schema apply --profile ...` at the default `database` scope wrongly planning to DROP platform objects owned by system roles (e.g. `DROP EVENT TRIGGER` owned by `supabase_admin`). Apply now resolves the policy managed view BEFORE projecting the management scope out — the same order `schema export` uses — so a policy's owner-exclusion rule still sees the `owner` edges that `projectManagementScope("database")` would otherwise strip. The scope projection is applied as the single managed-view-under-scope definition in the planner, the apply fingerprint gate, and the proof loop, preserving `plan == prove == run`.
- 52cb22a: Scope shadow body validation to non-seeded schemas: under `--profile supabase`, a broken routine in a pre-seeded platform schema (auth/storage/realtime/...) now surfaces as a warning instead of aborting the load, since seeded objects are reference-only on both sides of the diff. Body-validation diagnostics now name the failing routine (`schema.name: ...`), and the CLI's top-level error handler prints per-item error details instead of only the summary message.
- 52cb22a: Scope post-load routine body-validation leniency to the routines the Phase 2b assumed-schema seed actually created, by full overload-safe identity and unchanged body — instead of by schema name. A user-authored routine in an assumed/seeded schema (e.g. a broken function in `auth` on a Supabase quick apply), a new overload of a seeded routine name, or a `CREATE OR REPLACE` that changes a seeded routine's body now fails loudly again rather than merely warning and being silently never applied.
- 52cb22a: Fix four correctness/fidelity bugs:

  - **Sequence & identity bounds now apply atomically.** Moving more than one
    sequence option in a single diff (e.g. `MINVALUE 100 MAXVALUE 200` →
    `MINVALUE 1 MAXVALUE 50`) emitted one `ALTER SEQUENCE`/`ALTER COLUMN`
    statement per field, so a transient `MAXVALUE 50` ran while `MINVALUE` was
    still 100 and Postgres rejected the intermediate range. Both seams now emit a
    single combined statement that validates the final state, and realign the
    backing sequence's counter (`RESTART`) when the range moves entirely off the
    old start.
  - **`orderForShadow` no longer silently drops unparseable input.** When
    `@supabase/pg-topo` cannot parse a statement it returns an empty statement
    list, so the offending file vanished from the reordered output and a library
    caller built an incomplete desired state. The convenience API now throws a
    descriptive `ReorderParseError` instead (callers wanting graceful
    degrade-to-raw use `analyzeForShadow` and inspect its diagnostics).
  - **ACL privileges are de-duplicated across grantors.** `aclexplode()` emits one
    row per grantor, so the same privilege granted to a grantee by two grantors
    was recorded twice and rendered `GRANT SELECT, SELECT …`, which Postgres
    collapses on apply — breaking re-extract convergence.
  - **A security label on a view/matview column no longer crashes extraction.**
    View columns produce no column facts, so a label on one was parented on a
    missing fact and threw. Such labels are now reported via an
    `unresolved_security_label` diagnostic (strict mode blocks, default warns).

- 52cb22a: Stop exporting and dropping the platform-provided `supabase_realtime` publication under `--profile supabase` (#370).

  The Supabase platform creates the `supabase_realtime` publication at project init (owned by `postgres`, so no owner- or schema-based policy rule catches it). Users manage its membership — `ALTER PUBLICATION supabase_realtime ADD TABLE …` is the documented way to enable Realtime on a table — but never the publication object itself. pg-delta previously treated the whole publication as user state:

  - `schema export` rewrote it as `CREATE PUBLICATION supabase_realtime FOR TABLE …`, which is not replayable (the publication already exists on every Supabase database).
  - `schema apply` with declarative files that (correctly) omitted the publication planned a destructive `DROP PUBLICATION supabase_realtime`, which would break Realtime.
  - A membership-only declarative dir could not load into the co-located shadow at all (`ALTER PUBLICATION` referenced a publication the fresh shadow lacked).

  The Supabase policy now declares `supabase_realtime` as an **assumed publication** (a new `Policy.assumedPublications` field mirroring `assumedRoles` / `assumedSchemas`): the publication object is kept reference-only in the managed view — never created, dropped, or altered — while its membership facts stay fully managed and diff at rel grain. Export emits `ALTER PUBLICATION supabase_realtime ADD TABLE …` into `cluster/publications.sql`, apply leaves the publication itself untouched, and the co-located shadow seed materializes it (empty) so membership-only files load — including for custom profiles whose only assumed objects are publications. Comment / security-label satellites targeting a platform publication are excluded like other platform metadata (mirroring the existing system-schema satellite rule), so a platform-set comment absent from user files is never nulled out. `supabase_realtime_messages_publication` (Realtime broadcast-from-database, no user-manageable membership) is excluded outright. User-created publications — including their comments — are unaffected.

  Note: a declarative dir exported by an earlier version may still contain `CREATE PUBLICATION supabase_realtime …`; loading it now fails loudly with "publication already exists" — remove the statement (keeping any `ALTER PUBLICATION … ADD TABLE` lines) or re-export.

- 52cb22a: Fix five correctness issues in planning and extraction:

  - **Subscription `two_phase` change no longer drops the subscription.** It was classified as a "replace", so a `two_phase` flip emitted `DROP SUBSCRIPTION` + `CREATE SUBSCRIPTION` — dropping the publisher's replication slot and silently breaking replication. On PostgreSQL 18+ (which added `ALTER SUBSCRIPTION … SET (two_phase)`) the change now goes through `DISABLE` → `SET (two_phase)` → optional `ENABLE` and preserves the slot; on PG < 18 it fails loudly at plan time instead of doing the destructive recreate.
  - **Redacted subscriptions stay disabled.** A subscription rebuilt from a redacted extraction carries a placeholder connection string; the plan no longer emits the `ENABLE` follow-up (which would start a replication worker against a bogus host), and the redacted `CREATE` now carries a note telling the operator to set a real connection and enable it manually.
  - **Composite-attribute type dependencies order before `DROP TYPE`.** When a composite type's attribute stops using a user type that the same plan drops, the `ALTER TYPE … ALTER ATTRIBUTE … TYPE` now releases the old type (and consumes the new one), so it is ordered before the `DROP TYPE` instead of after it.
  - **`buildFactBase` rejects parent cycles.** A self-parent or parent cycle previously passed the missing-parent check yet reached no root, so the whole component was silently dropped from the fingerprint. Construction now throws, naming the cycle members.
  - **`file_fdw`'s `filename` option is no longer redacted.** `filename` (and `program`, `null`, `force_not_null`, `force_null`) are non-secret and are now preserved verbatim, so a default-redacted export no longer creates foreign tables pointing at the literal `__OPTION_FILENAME__`.

- 52cb22a: fix(pg-delta): exclude Supabase default privileges declared FOR a system role from the managed view

  `schema export --profile supabase` was emitting `ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" …` statements. A real Supabase user connects as `postgres` (a non-superuser) and can never execute an ADP declared FOR another role — that requires membership in the reserved role — so these statements made the export unappliable and polluted round-trips. The `supabase` policy now excludes default-privilege facts whose FOR-role is a system role, mirroring the existing owner-based exclusion for other object kinds. ADP declared FOR ROLE `postgres` (the user-owned API-role default) is unaffected regardless of which role is the grantee.

- 52cb22a: Move the SUSET-GUC (`pg_settings.context = 'superuser'`) probe used to strip a co-located-shadow seed's non-replayable `SET` clauses out of the `schema apply` CLI command and into `resolveProfile`, as `ResolvedProfile.susetGucs`. The probe is now gated on the applier actually being a non-superuser: a superuser applier seeds SUSET-proconfig routines instead of skipping them.
- 52cb22a: Prevent proof and shadow endpoint mixups by matching `pg`'s effective connection-string semantics, rejecting ambiguous duplicate endpoint parameters, and validating every trusted host. Preflight proof inputs before warning about possible clone mutation, document optional co-located shadows, and require explicit approval for data-destructive apply actions. Strictly validate plan action metadata, reject contradictory destruction declarations for intrinsically data-bearing objects in library apply/proof before mutation, classify cascading child destruction through its owning relation or type, follow accepted ancestor renames when proving descendant table data, fail proof when an undeclared persisted relation vanishes, and include implicitly destroyed extension members in `DROP EXTENSION` action metadata.

  - **Rendered migrations enforce destruction metadata integrity.** The renderer now rejects actions that destroy a table, materialized view, column, or composite attribute while claiming `dataLoss:none`, even when destructive rendering was explicitly allowed. Accepted same-action renames remain exempt, matching apply and prove.
  - **Proof clones and declarative shadows now use observed PostgreSQL identity.** CLI plans stamp domain-separated opaque hashes of `pg_control_system().system_identifier` (the physical-replication lineage) and the source database OID. `prove` rejects source aliases and same-lineage cluster-scoped clones before extraction or DDL; legacy/direct-library artifacts and servers that deny identity observation require the explicit `--allow-unverified-source-identity` seatbelt, which cannot override a confirmed match. Permission denials recommend the required grant and re-plan, while servers where `pg_control_system()` is unavailable report that unsupported capability without impossible grant advice. Explicit schema shadows use the same transport-independent checks with connection-specific permission diagnostics, while an isolation request now requires an explicit shadow from a different lineage. The public `planSchemaFiles` frontend enforces the same database and lineage invariants before profile resolution or shadow loading, rather than trusting its `isolatedShadow` assertion and disabling shared-cluster containment on an unsafe pool. Physical/base-backup clones retain the source identity and are intentionally unsupported.

- 52cb22a: Plan ordering: actions that evaluate user expressions at apply time (column defaults, generated columns, CHECK validation, expression indexes, materialized-view population) are now scheduled after all ready definition actions, so opaque quoted routine bodies can resolve their helpers. An action counts as evaluating whenever a routine is _reachable_ from the expression's recorded structure — including indirectly, e.g. a materialized view that selects from a view which calls the routine, or a column whose domain type carries a CHECK that calls it.
- 52cb22a: Fix two dropped pg_depend endpoint resolutions in extract that lost real
  dependency edges (issue #333). A user-defined window function (`prokind 'w'`)
  is now resolved as a `function` fact, so a view or rule that uses it is ordered
  and rebuilt against it. A user-created rule on a plain table (or any rule other
  than a view/matview `_RETURN`) now resolves to its own `rule` fact instead of
  being dropped, so the rule is rebuilt before a function it references is
  dropped. Previously either endpoint resolved to NULL and the edge was silently
  skipped, causing `apply` to fail with "cannot drop function … because other
  objects depend on it".

## 1.0.0-alpha.33

### Patch Changes

- 2b803b1: fix(pg-delta): correctly diff PUBLIC's built-in default privilege so REVOKE ... FROM PUBLIC is no longer silently dropped for functions, procedures, aggregates, domains, enums, ranges, composite types, and languages

  `filterPublicBuiltInDefaults` stripped any `grantee === "PUBLIC"` entry
  matching an object type's implicit default privilege (EXECUTE for
  procedures/aggregates, USAGE for domains/enums/ranges/composite
  types/languages) from both sides of a privilege diff, unconditionally.

  For altered objects, both sides' privileges are already extracted via
  `COALESCE(<acl-column>, acldefault(...))`, so they correctly and
  symmetrically reflect PostgreSQL's implicit PUBLIC default (or its
  explicit revocation) with no filtering needed at all - stripping PUBLIC
  from both sides turned "existing object + a new PUBLIC revoke on one
  side" into an empty diff.

  For newly created objects, the "effective defaults" side (tracked via
  `ALTER DEFAULT PRIVILEGES` customizations) never encodes PostgreSQL's
  hardcoded PUBLIC fallback, while the desired object's real ACL does -
  filtering PUBLIC off the desired side to paper over that asymmetry
  erased the signal whenever the desired state revoked PUBLIC's default.
  A new `withPublicBuiltInDefault` helper now adds that built-in default
  back onto the defaults side instead, so both sides compare
  symmetrically and an explicit `REVOKE ... FROM PUBLIC` in the desired
  state is preserved.

## 1.0.0-alpha.32

### Patch Changes

- c229fcf: fix(pg-delta): allow catalog extraction as a non-superuser role

  Extraction previously SELECTed from `pg_catalog.pg_user_mapping` (superuser-only), so any non-superuser connection — e.g. the `postgres` role on Supabase hosted projects — failed with `permission denied for table pg_user_mapping` (42501). User mappings are now read from the world-readable `pg_user_mappings` view; option values hidden from unprivileged readers degrade to an empty option list instead of erroring. The subscription extractor similarly stops selecting the superuser-only `pg_subscription.subconninfo` column unless the reader has privilege, degrading to the existing redacted-conninfo placeholder. Fixes supabase/cli#5826.

## 1.0.0-alpha.31

### Patch Changes

- f5ec852: fix(pg-delta): preserve the event/table clause when formatting triggers with quoted names

  A trigger whose name must be double-quoted (e.g. it contains a dash, like a Supabase webhook named `send-chat-push`) had its generated DDL mangled: the SQL formatter dropped the `AFTER INSERT ON <table>` event/table clause, producing invalid migration SQL. The tokenizer skipped double-quoted identifiers entirely, so the trigger formatter mistook the next keyword for the trigger name and sliced away everything before the first recognized clause. The tokenizer now emits an atomic token for double-quoted identifiers, which also fixes the same latent issue for other object types whose names follow a keyword positionally (subscriptions, servers, foreign data wrappers, etc.).

- Updated dependencies [c06f081]
  - @supabase/pg-topo@1.0.0-alpha.3

## 1.0.0-alpha.30

### Major Changes

- c4b90f5: Replace the flat `plan.statements` list with execution-aware migration units.

  A plan is now an ordered list of `MigrationUnit`s (`plan.units`) plus session-level statements (`plan.sessionStatements`). Each unit carries an explicit `transactionMode` and a boundary `reason`, so plans whose statements cannot share one transaction are represented and applied correctly:

  - `ALTER TYPE ... ADD VALUE` and any later statement now run in separate transactions, fixing PostgreSQL error 55P04 ("unsafe use of new value of enum type") when a migration adds an enum value and uses it (#262).
  - Statements PostgreSQL rejects inside a transaction block — `ALTER SUBSCRIPTION ... SET PUBLICATION` with implicit `refresh = true`, `DROP SUBSCRIPTION` with an associated replication slot — are applied as standalone non-transactional units instead of failing inside `BEGIN`/`COMMIT`.
  - `CREATE SUBSCRIPTION` for a subscription whose replication slot already exists now emits `create_slot = false` (keeping `connect = true`), so the existing slot is reused instead of failing with "replication slot already exists"; that form is transactional (PostgreSQL's transaction-block gate is on `create_slot = true`).

  Execution semantics are declared on the change classes (`nonTransactional`, `commitBoundary`), never inferred from rendered SQL.

  **Migrating from `plan.statements`:**

  ```ts
  // before
  const script = plan.statements.join(";\n");

  // after — transaction-aware script (BEGIN/COMMIT per unit, unit headers)
  const script = renderPlanSql(plan);
  // or one numbered file per unit (also: pgdelta plan --output-dir <dir>)
  const files = renderPlanFiles(plan);
  // or the raw ordered statements (session statements included) when
  // transaction context does not matter
  const statements = flattenPlanStatements(plan);
  ```

  **`applyPlan` result changes:**

  ```ts
  // before
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; script: string }

  // after
  | { status: "applied"; statements: number; units: number; warnings?: string[] }
  | { status: "failed"; error: unknown; script: string;
      failedUnitIndex?: number; completedUnits: number }
  ```

  **Behavioral consequences:**

  - Multi-unit plans are **not atomic as a whole**: earlier units commit before later units run, and a later failure does not roll back already-committed units (an added enum value cannot be dropped). `applyPlan` reports the failing unit and how many units committed.
  - Non-transactional units run without any transaction wrapper. Rendered scripts must be executed by a statement-splitting runner such as `psql -f` (not as a single multi-statement query string, and not with `psql --single-transaction`): PostgreSQL runs multi-command strings in an implicit transaction block, which would fail any non-transactional unit.
  - Single-unit plans (the common case) still apply as one transaction.

  **Plan JSON:** new plans are written as `version: 2` with `units`. Legacy v1 plan files (flat `statements`) are still read and normalized into a single transactional unit — faithful to how v1 executed them — but v2 plan files are not readable by older pg-delta versions.

  **New:** unorderable dependency cycles now throw a typed `UnorderableCycleError` (exported) carrying the offending changes in `error.cycle`, instead of a plain `Error` that callers had to string-match. And `pgdelta plan --output-dir <dir>` writes one numbered, transaction-aware SQL file per migration unit.

## 1.0.0-alpha.29

### Patch Changes

- 115dde8: Fix unhandled `CycleError` when dropping a FK chain of tables alongside a referenced unique constraint while only some of the involved tables are publication members. The publication FK-chain cycle breaker required every dropped table in the cycle to be a member of the publication, but publications like `supabase_realtime` commonly contain only a subset of tables; the guard now only requires the publication edge that actually participates in the cycle.
- Updated dependencies [a5a69fc]
- Updated dependencies [cf0df37]
- Updated dependencies [436b3d1]
  - @supabase/pg-topo@1.0.0-alpha.2

## 1.0.0-alpha.28

### Patch Changes

- 9f01826: Order dependent view drops before column type rewrites, and preserve view or materialized-view metadata, including ACL adjustments, when those dependents are dropped and recreated during replacement.
- f95e0a8: Recreate RLS policies that depend on replaced functions.
- e396579: Recreate RLS policies that depend on rewritten columns.

## 1.0.0-alpha.27

### Minor Changes

- b9b8b15: Add `--filter` option to the `catalog-export` CLI command to scope the exported catalog to matching schemas/objects.

### Patch Changes

- 71cce8a: fix(pg-delta): suppress user triggers on pgmq queue/archive tables in supabase integration

  Follow-up to the Wasm FDW dependents fix. `pgmq.q_<name>` and `pgmq.a_<name>` are materialized lazily by `select pgmq.create('<name>')`, not by `CREATE EXTENSION pgmq`. The trigger extractor already drops these via the `pg_depend deptype='e'` row that pgmq records, but real-world cloud projects can lose that row (older pgmq versions — pgmq `1.4.4` which Supabase Cloud currently ships never records it — manual `pg_dump`/restore that strips extension deps, etc.), so `supabase db reset` aborts at the trigger statement with `relation "pgmq.q_<name>" does not exist`. Add a defensive name-match fallback in the supabase integration filter so the trigger is dropped even when the principled signal is missing.

- 71cce8a: fix(pg-delta): suppress Wasm FDW servers, foreign tables, and user mappings in supabase integration

  Follow-up to CLI-1470. Also suppress SERVER (object/comment/security-label scopes), FOREIGN TABLE, and USER MAPPING changes whose parent wrapper is a Supabase Wasm FDW — identified by the `extensions.wasm_fdw_handler` / `extensions.wasm_fdw_validator` functions the `wrappers` extension ships — so `db pull` no longer emits `CREATE SERVER clerk_oauth_server` for platform Wasm FDWs that local Docker cannot provision.

  The discriminator is the Wasm handler/validator function names, not the bare `extensions.*` namespace: contrib FDWs like `postgres_fdw` install their handler/validator into `extensions` on Supabase too, but they ARE available in the local image, so user-created `postgres_fdw` wrappers (and their servers, foreign tables, and user mappings) must still roundtrip. Server _privilege_ scope is likewise preserved — `GRANT/REVOKE ON SERVER` does not require superuser.

## 1.0.0-alpha.26

### Patch Changes

- 82d4700: feat(pg-delta): emit `VALIDATE CONSTRAINT` shortcut when only `validated` flips from false to true

  When the only difference between main and branch for an existing table constraint is `convalidated` flipping from `false` to `true` (i.e. the user wants to validate a previously `NOT VALID` constraint), pg-delta now emits a single `ALTER TABLE ... VALIDATE CONSTRAINT ...` instead of dropping and re-adding the constraint.

  `VALIDATE CONSTRAINT` only takes `SHARE UPDATE EXCLUSIVE` on the table (concurrent reads and writes continue while the row scan runs), whereas drop+add takes `ACCESS EXCLUSIVE` for the duration of the scan. This matches the standard "ADD CONSTRAINT ... NOT VALID; later VALIDATE CONSTRAINT" two-phase safe-migration pattern.

  The reverse direction (`validated` → `NOT VALID`) has no equivalent Postgres command, so it still goes through drop+add. Any other field change (expression, key columns, FK target, on_delete, etc.) on top of a `validated` flip also still goes through drop+add — the shortcut applies only when nothing else differs.

- 6d49e04: fix(pg-delta): clear the connect-timeout timer when the race settles

  `createManagedPool` raced `pool.connect()` against a `setTimeout` rejection but never cleared the timer. When the connect won (the normal, fast case), the pending `setTimeout` kept the event loop alive, so the process hung for the rest of `PGDELTA_CONNECT_TIMEOUT_MS` even though the plan was already done. Raising the timeout for far-away databases made every local run wait that long too. The race now goes through a `connectWithTimeout` helper that clears the timer in a `.finally`.

- 82d4700: fix(pg-delta): stop re-validating NOT VALID constraints

  A NOT VALID constraint was followed by a VALIDATE CONSTRAINT step that flipped it back to validated, so the plan never converged. ADD CONSTRAINT already carries the NOT VALID suffix, so the VALIDATE was redundant. It's now dropped from the create, alter, and table-replacement paths.

## 1.0.0-alpha.25

### Patch Changes

- f1704bd: fix(pg-delta): keep user-defined triggers on auth/storage tables through the supabase filter

  User-attached triggers on `auth.users`, `storage.objects`, etc. were being dropped from `supabase` integration diffs because triggers live in their parent table's schema and inherit its owner — both signals the Supabase managed-schema filter uses to skip Supabase's own objects. The filter now keeps any trigger whose function lives outside the managed schemas, which is the reliable user-defined marker.

- 62f39d4: fix(pg-delta): emit valid GRANT/REVOKE syntax for ordered-set, hypothetical-set, and variadic aggregates

  `GrantAggregatePrivileges` / `RevokeAggregatePrivileges` /
  `RevokeGrantOptionAggregatePrivileges` previously serialized the
  aggregate signature using `pg_get_function_identity_arguments`, which
  embeds `ORDER BY` for ordered-set / hypothetical-set aggregates
  (`aggkind` of `o` / `h`) and `VARIADIC` for variadic aggregates. The
  PostgreSQL `GRANT ... ON FUNCTION` parser rejects both keywords inside
  the argument list, so the generated `GRANT`/`REVOKE` failed with a
  syntax error for any aggregate that wasn't a plain `aggkind = 'n'`.
  The serializer now uses the `proargtypes`-derived `argument_types`
  list, matching the signature shape PostgreSQL expects for `GRANT`/`REVOKE`.

- ae4c499: fix(pg-delta): skip redundant `ALTER TABLE … ADD CONSTRAINT` for CHECK constraints inherited by partition children

  Previously the inheritance signal used `pg_constraint.conparentid <> 0`, but PostgreSQL only populates `conparentid` for PK / UNIQUE / FK constraints on partitions — CHECK constraints on partitions always have `conparentid = 0`. As a result, pg-delta re-emitted every inherited CHECK constraint against each partition, and apply failed with SQLSTATE 42710 ("constraint already exists") because the constraint had already been auto-created on the partition by Postgres when the parent's constraint or the partition itself was created. The extractor now uses `coninhcount > 0`, the canonical inheritance flag, which covers CHECK and all other constraint kinds uniformly.

- 0d52b68: Redact foreign-data-wrapper option values that are not on the allowlist of known-safe keys (libpq connection params, postgres*fdw behavior knobs, generic table-FDW shape, Supabase Wrappers non-credential keys). The policy applies to `CREATE / ALTER FOREIGN DATA WRAPPER`, `CREATE / ALTER SERVER`, `CREATE / ALTER USER MAPPING`, and `CREATE / ALTER FOREIGN TABLE` — every value is replaced with `\_\_OPTION*<KEY>\_\_`unless the key is recognised as safe. Previously credentials such as`password`, `passfile`, `passcode`, `sslpassword`, `api_key`, `private_key`, `aws_secret_access_key`, etc. were emitted in cleartext into plan SQL, catalog snapshots, declarative export, and fingerprints, ending up on disk and in CI logs (CLI-1467). Safe-listed options (`host`, `port`, `user`, `dbname`, `sslmode`, `fetch_size`, `region`, `endpoint`, …) continue to roundtrip with their real values. The emitted DDL is not directly re-appliable for redacted options — operators must re-supply credentials out of band.
- 62f39d4: fix(pg-delta): suppress GRANT/REVOKE on FOREIGN DATA WRAPPER in the supabase integration

  `GRANT`/`REVOKE ... ON FOREIGN DATA WRAPPER` requires superuser. On Supabase Cloud the `postgres` role has the elevated rights to apply these grants, but the local Docker image does not — so the previous diff output broke `supabase db reset` with `permission denied for foreign-data wrapper dblink_fdw`. The existing system-role rule already covers wrappers owned by `supabase_admin`, but `pg_dump` rewrites OWNER TO clauses to whoever the dump runs under, so after a restore the FDW ends up owned by `postgres` and slips past the owner gate. The supabase integration filter now drops privilege-scope changes on `foreign_data_wrapper` regardless of owner, since the FDW ACL is never user-replayable in the local image. `FOREIGN SERVER` ACL is intentionally left alone — server GRANT/REVOKE doesn't require superuser, and user-created servers (e.g. a `dblink` server pointing to a peer DB) carry legitimate user ACL that should still roundtrip.

- 62f39d4: fix(pg-delta): suppress CREATE/DROP/ALTER FOREIGN DATA WRAPPER for platform-managed Wasm wrappers in the supabase integration

  The `supabase` integration now skips any FDW whose `HANDLER` or `VALIDATOR` references a function in the `extensions` schema. This covers the Wasm-based wrappers (`clerk`, `clerk_oauth`, etc.) that Supabase Cloud provisions as `supabase_admin` at project creation. `CREATE FOREIGN DATA WRAPPER` requires superuser, and the local Docker image has no equivalent pre-step, so the previous diff output broke `supabase db reset`. Owner-based filtering wasn't enough because the wrapper owner is often rewritten away from `supabase_admin` after a dump/restore.

## 1.0.0-alpha.24

### Patch Changes

- 471f770: Fix drop-phase cycle breaking when publication table membership removal intersects with dropped foreign-key chains and a referenced constraint drop.
- 471f770: Fix `DropSequence ↔ DropTable` drop-phase cycle when an owning table is
  promoted to `DropTable + CreateTable` by `expandReplaceDependencies` (for
  example when a referenced enum has a label removed) and the same plan also
  drops the SERIAL sequence because branch no longer carries the owned sequence.

  `diffSequences.dropped` short-circuits `DropSequence` only when the owning
  table itself is absent from the branch catalog. When the table survives in
  branch but is later replaced via expansion (table is in `replacedTableIds`),
  the explicit `DROP SEQUENCE` survives into the drop phase alongside the
  expander's `DropTable`, and the bidirectional pg_depend edges between the
  sequence and its owning column close an unbreakable 2-cycle that none of the
  existing dependency-filter / change-injection breakers match.

  `normalizePostDiffChanges` now prunes `DropSequence(S)` whenever S is `OWNED
BY` a column on a table in `replacedTableIds`. The `DROP TABLE` cascade
  already drops the OWNED BY sequence at apply time, so the explicit
  `DROP SEQUENCE` was both redundant and the source of the cycle.

## 1.0.0-alpha.23

### Minor Changes

- 9a0831a: feat(pg-delta): add support for PostgreSQL SECURITY LABEL across all 17 supported object types (schemas, tables, columns, views, materialized views, sequences, functions, procedures, aggregates, composite/enum/range types, domains, event triggers, foreign tables, publications, subscriptions, roles). Includes round-trip fidelity, a new `scope: "security_label"` in the filter DSL, and per-provider filtering via the new `provider` extractor.

### Patch Changes

- 9a0831a: Expose security-label providers to the filter DSL so provider-specific security label filters work as documented.

## 1.0.0-alpha.22

### Minor Changes

- 2d1991a: feat(pg-delta): retry catalog extractors when `pg_get_*def()` returns NULL

  `pg_get_indexdef`, `pg_get_constraintdef`, `pg_get_viewdef`, `pg_get_triggerdef`, `pg_get_ruledef`, and `pg_get_functiondef` can transiently return NULL when the underlying catalog row is dropped concurrently or the catalog state is in flux. Previously such rows were dropped silently after one attempt; now extraction retries the affected query a configurable number of times before falling back to filtering. In practice the second attempt no longer sees the dropped object (or successfully resolves the definition), so a real CREATE/DROP racing with `createPlan` is reliably preserved or excluded rather than half-captured.

  Configuration (precedence: option > env > default):

  - `CreatePlanOptions.extractRetries?: number` — public API option on `createPlan`.
  - `PGDELTA_EXTRACT_RETRIES` env var — same value, useful for CLI usage.
  - Default `1` (i.e. the first attempt plus one retry, 2 attempts total).

  After retries are exhausted, rows whose `pg_get_*def()` is still NULL are filtered out and a warning is emitted via `debug('pg-delta:extract')` (visible with `DEBUG=pg-delta:extract` or `DEBUG=pg-delta:*`). Setting `extractRetries: 0` disables retrying entirely and reproduces the previous "filter-on-first-attempt" behavior.

### Patch Changes

- 9e3541d: fix(pg-delta): order dependency-breaking ALTERs before DROP for types, sequences, and policies (#230)

  `ALTER COLUMN ... DROP DEFAULT`, `ALTER COLUMN ... DROP IDENTITY`, and
  `ALTER COLUMN ... TYPE <built-in>` are now scheduled in the drop phase so
  that the catalog edges in `pg_depend` order them ahead of the matching
  `DROP TYPE` / `DROP SEQUENCE`. `ALTER COLUMN ... TYPE` also drops any
  existing default before the rewrite (and re-emits a `SET DEFAULT` after)
  so the stale default expression cannot pin the old type. RLS policies
  whose `USING` / `WITH CHECK` expressions begin or stop referencing
  different functions or relations are now emitted as drop+create, letting
  the policy's drop run before the referenced object's drop and the
  policy's recreate run after the new object's create. Plans that
  previously aborted with PostgreSQL `2BP01` ("cannot drop ... because
  other objects depend on it") now apply cleanly.

- 2d1991a: fix(pg-delta): skip rows when `pg_get_viewdef`, `pg_get_triggerdef`, `pg_get_ruledef`, or `pg_get_functiondef` returns NULL instead of crashing the relevant `extract*` with a ZodError. Same race conditions as the prior `pg_get_indexdef` (#223) and `pg_get_constraintdef` fixes — the underlying catalog row can vanish (concurrent DDL, transient catalog state, recovery edges). A single unreadable view, materialized view, trigger, rule, or function no longer aborts the whole catalog extraction and `createPlan` call.
- 7c7d18a: fix(pg-delta): produce applyable migrations for `RENAME` operations seen as drop+create

  `pg-delta` is a state-based diff and treats a `RENAME` as `DROP+CREATE` because
  the final catalogs are indistinguishable. Two scenarios in that drop+create
  path failed at apply time on schemas that had been renamed in the target
  (reported in [#228](https://github.com/supabase/pg-toolbelt/issues/228)):

  - A table with a `SERIAL` column renamed in the target left the same-name
    sequence (e.g. `old_table_id_seq`) "altered" in the diff (only its
    `OWNED BY` ref changed). `DROP TABLE` cascade-drops the sequence via
    `OWNED BY`, after which the freshly created table's column default
    `nextval('old_table_id_seq'::regclass)` referenced a non-existent relation
    and the migration aborted. `diffSequences` now detects when the sequence's
    main-side owning table is going away in the same plan and recreates the
    sequence after the cascade, while suppressing an explicit `DROP SEQUENCE`
    that would form an unbreakable cycle with `DropTable`.
  - A table renamed in the target with a dependent view (e.g.
    `CREATE VIEW user_count AS SELECT count(*) FROM users` with the table
    renamed to `members`) failed with `cannot drop table users because other
objects depend on it`. `expandReplaceDependencies` now seeds drop-only
    schema objects (table, view, materialized view, type, domain) as expansion
    roots so any surviving dependent in `pg_depend` gets promoted to
    `DROP+CREATE`. The dependent's drop is sequenced before the parent drop,
    and its create runs after the new replacement is in place.

- 3b9eb91: fix(pg-delta): preserve `REPLICA IDENTITY USING INDEX` on tables instead of silently reverting to `DEFAULT` on declarative sync.

  The table extractor only stored `replica_identity` as a single character (`'d' | 'n' | 'f' | 'i'`) and discarded the index name when the mode was `'i'`. The diff path then explicitly skipped mode `'i'` ("handled by index changes" — but no such handler existed), and `AlterTableSetReplicaIdentity.serialize()` fell back to `REPLICA IDENTITY DEFAULT` for that mode. Compounding this, `Index.is_replica_identity` participated in equality and was marked non-alterable, so toggling the flag on the index triggered a spurious `DROP INDEX` + `CREATE INDEX` — and Postgres reverts the table to `REPLICA IDENTITY DEFAULT` whenever the configured replica-identity index is dropped.

  End result: a table configured with `ALTER TABLE foo REPLICA IDENTITY USING INDEX foo_idx` would extract as `replica_identity = 'i'` but produce no setter on diff. The next `declarative sync` would generate a migration that dropped the user's index, reset the table to `DEFAULT`, and recreated the index — never converging (reported as supabase/cli#5141).

  The fix:

  - `Table.replica_identity_index` is extracted via `pg_index.indisreplident` and included in `dataFields`, so the index name participates in equality.
  - `AlterTableSetReplicaIdentity` now serializes `REPLICA IDENTITY USING INDEX <name>` for mode `'i'` and declares the index as a `requires` dependency so it is created first.
  - The table diff emits the change for all modes (including `'i'`) on both `CREATE` and `ALTER`, and re-emits when the configured index name changes while staying in `'i'` mode.
  - `Index.is_replica_identity` is no longer in `dataFields` / `NON_ALTERABLE_FIELDS`; the table side is the source of truth, set via `ALTER TABLE`. This stops the spurious `DROP INDEX` + `CREATE INDEX` cycle.
  - A new `restoreReplicaIdentityAfterIndexReplace` pass in `post-diff-normalization.ts` re-emits `ALTER TABLE ... REPLICA IDENTITY USING INDEX <name>` after any `DropIndex(idx) + CreateIndex(idx)` pair where `idx` is the replica-identity index of a branch table. This covers the second flavor of the bug: when both main and branch already point at the same replica-identity index, but that index's _definition_ changes (e.g. a column added to its key), the index is replaced, Postgres silently flips `relreplident` to `'d'`, and the table-level diff alone cannot see the cross-object interaction. The pass is idempotent — if `diffTables()` already emitted the same setter (because the table is also flipping mode or pointing to a different index), no duplicate is added.

  The post-diff layer file `src/core/post-diff-cycle-breaking.ts` is renamed to `post-diff-normalization.ts` and `normalizePostDiffCycles` to `normalizePostDiffChanges` — the file already contained dedup and replacement-superseded pruning that aren't strictly cycle-breaking, and actual cycle breaking moved to the lazy sort-phase dispatcher in a previous release. The rename brings the file in line with the "post-diff normalization" terminology already used in the package's `CLAUDE.md` rule of thumb.

- 2d1991a: fix(pg-delta): skip table constraints where `pg_get_constraintdef()` returns NULL instead of crashing `extractTables` with a ZodError. Like `pg_get_indexdef`, `pg_get_constraintdef` can return NULL under race conditions with concurrent DDL or transient catalog inconsistencies. Such constraints are now filtered out at extraction time so a single unreadable constraint no longer aborts the whole catalog extraction and `createPlan` call.

## 1.0.0-alpha.21

### Patch Changes

- fa3f736: fix(pg-delta): emit USING and default-safe flow for ALTER COLUMN TYPE
- 363fef3: Fix ZodError when extracting tables with EXCLUDE constraints defined over expressions. PostgreSQL stores `attnum=0` in `pg_constraint.conkey` for expression elements, which never matches `pg_attribute`, so the inner aggregate returned SQL `NULL` and tripped `tablePropsSchema` at `constraints[*].key_columns`. The extractor now coalesces the aggregate to an empty JSON array.
- cbe8946: Defer drop-phase cycle breaking from `normalizePostDiffCycles` to a lazy
  dispatcher invoked by `sortPhaseChanges` only when edge filtering can't
  break a cycle. The happy path (no cycles, the vast majority of plans) no
  longer walks `iterCrossDropFkConstraints` on every diff. The new
  dispatcher generalizes the existing 2-cycle FK breaker to any
  N≥2 strongly-connected component of dropped tables (for example
  `a→b→c→a`) and breaks the
  `AlterPublicationDropTables ↔ AlterTableDropColumn` cycle that occurred
  when a publication-listed column was dropped on a surviving table. The
  breaker round-cap scales with `phaseChanges.length` so big diffs with
  many independent unbreakable cycles in a single phase resolve cleanly
  instead of throwing a spurious `CycleError`.

  The sequence diff path now alters `data_type` in place via
  `ALTER SEQUENCE ... AS <type>` (valid PostgreSQL since PG10) instead of
  emitting `DROP SEQUENCE + CREATE SEQUENCE`. This eliminates a
  production `CycleError` seen on alpha.16 (Sentry SUPABASE-API-7RS,
  "DropSequence ↔ DropTable") triggered when a sequence whose
  `data_type` changes is referenced by a `DEFAULT nextval(...)` on a
  surviving column. Altering in place also fixes a silent data-loss
  regression where the recreated sequence would restart at `1` and
  collide with existing row ids.

## 1.0.0-alpha.20

### Patch Changes

- ac7b9b8: fix(pg-delta): skip `WITH SCHEMA` when serializing `pgsodium` and `pg_tle` under the Supabase integration

  Both extensions create their install schema (`pgsodium`, `pgtle`) themselves, and those schemas are filtered out of the declarative plan by the Supabase integration because they live in `SUPABASE_SYSTEM_SCHEMAS`. Emitting `CREATE EXTENSION pgsodium WITH SCHEMA pgsodium` (or the equivalent for `pg_tle`) therefore fails against a fresh database with `schema "pgsodium" does not exist` — the same bug shape PR #191 fixed for `pgmq`.

  Closes supabase/pg-toolbelt#222.

## 1.0.0-alpha.19

### Patch Changes

- 4867d88: Handle dependent index and view recreation when replacing a materialized view. Constraint-owned, primary, and partition-attached indexes are left to the owning constraint or parent-index DDL so table replacement does not emit a standalone `DROP INDEX` on a PK-owned index.
- f00e9a4: fix(pg-delta): skip indexes where `pg_get_indexdef()` returns NULL instead of crashing `extractIndexes` with a ZodError. The three-argument form of `pg_get_indexdef` can return NULL under race conditions with concurrent DDL (e.g. the index being dropped mid-extraction) or when catalog metadata is transiently inconsistent. Such indexes are now filtered out with a debug log (`DEBUG=pg-delta:extract:index`) so a single unreadable index no longer aborts the whole catalog extraction and `createPlan` call.
- f33d579: fix(pg-delta): order RLS policies after referenced new objects

  Policies whose `USING` / `WITH CHECK` expression references another new object could be emitted before the referenced object on a fresh database, causing plan/apply to fail.

  `extractRlsPolicies` now joins `pg_depend` to surface every relation (tables, partitioned tables, views, materialized views, foreign tables) and function the policy expression references. PostgreSQL already records those edges at `CREATE POLICY` time via `recordDependencyOnExpr`, so the catalog is authoritative and pg-delta's core diffing path does not reparse the expression text. `CreateRlsPolicy.requires` dispatches per relation kind and emits `stableId.procedure(...)` for functions, using the exact argument signature produced by `format_type(proargtypes)` — matching the signature embedded in the procedure extractor's stable id.

  Sequences referenced via `nextval('seq'::regclass)` remain a known gap (tracked as a skipped regression test) because `pg_depend` only records the edge for `regclass` literal arguments.

## 1.0.0-alpha.18

### Patch Changes

- feca870: fix(pg-delta): diff PostgreSQL 18 temporal constraints
- b812a46: fix(pg-delta): emit DROP + CREATE for function signature changes (return type, parameter names, parameter defaults, modes) instead of unsupported `CREATE OR REPLACE FUNCTION`
- feca870: fix(pg-delta): dedupe duplicate constraint ADDs on tables promoted to drop+create

  When a table transitively depends on a replaced object (for example a
  foreign key whose referenced primary key is being dropped and re-added to
  flip to `WITHOUT OVERLAPS` / `PERIOD`), `expandReplaceDependencies()`
  promotes the table to a full `DropTable + CreateTable` pair and emits one
  `AlterTableAddConstraint` (plus optional `VALIDATE CONSTRAINT` /
  `COMMENT ON CONSTRAINT`) per branch constraint. The original
  `diffTables()`-emitted `AlterTableAddConstraint` targeting the same
  constraint on the same replaced table was previously left in the plan,
  producing duplicate `ALTER TABLE ... ADD CONSTRAINT` statements and a
  `constraint "..." for relation "..." already exists` apply failure.

  `normalizePostDiffCycles()` now dedupes same-table
  `AlterTableAddConstraint`, `AlterTableValidateConstraint` and
  `CreateCommentOnConstraint` changes keyed by
  `(changeType, table.stableId, constraint.name)` on replaced tables,
  keeping only the last occurrence. Because `expandReplaceDependencies()`
  appends its additions after the original `diffTables()` output, the last
  occurrence is always the expansion's emission — so correctness is
  preserved while the earlier duplicate is removed. This fixes migrations
  that combine a temporal-PK flip on one table with a temporal-FK flip on a
  related table without regressing unrelated replace-expansion scenarios
  (enum value removal, table replacement via other object replacements).

## 1.0.0-alpha.17

### Patch Changes

- 5cc2a21: fix(pg-delta): stop emitting spurious `CREATE OR REPLACE TRIGGER` on logically-identical triggers whose underlying tables have different physical column layouts.

  The trigger diff was comparing `pg_trigger.tgattr` (raw physical attnums) as part of its non-alterable fields. When the same logical trigger (e.g. `BEFORE UPDATE OF col_a, col_b ...`) existed on two tables with different physical column layouts — one built via a single `CREATE TABLE`, the other grown via `ALTER TABLE DROP/ADD COLUMN` (which leaves "dead" attnums that are never renumbered) — the attnum vectors diverged while the trigger definition (rendered by `pg_get_triggerdef()` using column names) was byte-identical. The diff kept firing a `ReplaceTrigger` every round, and because `CREATE OR REPLACE TRIGGER` does not renumber the table's physical columns, the loop never converged.

  Triggers are now compared by `pg_get_triggerdef()` output (column names) instead of raw `tgattr` attnums, matching the existing `Index` pattern that handles the same class of bug for `indkey`.

## 1.0.0-alpha.16

### Patch Changes

- a0f6f11: fix(pg-delta): strip brackets from IPv6 hosts before handing them to pg so `getaddrinfo` sees a bare address.

  The alpha.14 IPv6 fix normalized percent-encoded hosts into the canonical bracketed URL form (`postgresql://user@[2600:...]:5432/db`). That is a valid URL, but `pg-connection-string`'s WHATWG-based parser keeps the brackets on `config.host`, so `pg` passed `[2600:...]` verbatim to `getaddrinfo` and connections failed with `ENOTFOUND [2600:...]`.

  `createManagedPool` now expands bracketed-IPv6 URLs into explicit `host` / `port` / `user` / `password` / `database` pool fields (plus any remaining query params like `application_name`) and drops `connectionString` on that path — `pg` merges a parsed `connectionString` on top of user config, so a co-provided `host` would otherwise be clobbered. Non-IPv6 URLs still go through `connectionString` unchanged.

## 1.0.0-alpha.15

### Patch Changes

- 82be5f4: fix(pg-delta): break drop-phase cycles for owned-sequence column drops and replace-dependency table recreates

  Two previously unbreakable drop-phase `CycleError`s are now fixed at the
  source by eliding redundant changes instead of patching the sort-phase
  cycle filter.

  - `diffSequences` now skips `DROP SEQUENCE` when the owning column is
    dropped on a surviving table (e.g. dropping a `SERIAL` column).
    PostgreSQL's `OWNED BY` cascade already drops the sequence with the
    column, so emitting `DROP SEQUENCE` both failed at apply time and formed
    an unbreakable cycle with `AlterTableDropColumn`. This mirrors the
    existing short-circuit for whole-table drops.
  - `expandReplaceDependencies` now removes pre-existing
    `AlterTableDropColumn(T.col)` and `AlterTableDropConstraint(T.c)` changes
    when it enqueues a `DropTable(T) + CreateTable(T)` replacement pair for
    the same table. Those are the only `AlterTable*` subclasses whose
    `requires` includes `table.stableId`, producing a `column:T.col → table:T`
    (or `constraint:T.c → table:T`) explicit edge that closed an unbreakable
    drop-phase cycle against catalog `constraint → column → table` edges.
    Supersession is scoped to those two classes only; other `AlterTable*(T)`
    changes (owner, RLS toggles, replica identity, storage params,
    SET LOGGED/UNLOGGED) and privilege-scope ALTERs (GRANT/REVOKE) are
    preserved so the recreated table ends up in the correct state — the sort
    phase orders them after `CreateTable(T)` via their `table.stableId`
    requirement.

- 82be5f4: fix(pg-delta): break drop-phase cycle when two tables have mutual FK references

  Previously, diffing two databases where two tables each hold a foreign key
  pointing at the other (and both tables are being dropped) produced a
  `CycleError` because both `DropTable` changes claimed the other's FK
  constraint stableId, creating bidirectional catalog edges in the drop-phase
  graph. Even if the cycle had been broken at the sort layer, plain
  `DROP TABLE` would have failed at apply time because PostgreSQL refuses to
  drop a table while another table still has an FK pointing to it.

  The diff layer now detects mutual FK references between tables dropped in
  the same phase and emits explicit `ALTER TABLE ... DROP CONSTRAINT ...`
  statements before the `DROP TABLE`s, producing a safe linear sequence and
  no cycle in the drop-phase graph.

## 1.0.0-alpha.14

### Patch Changes

- 13e94b9: fix(pg-delta): auto-normalize percent-encoded IPv6 hosts in connection URLs and retry transient connect failures.

  Connection strings with URL-encoded IPv6 hosts (e.g. `postgresql://user:pass@2406%3Ada18%3A...%3Ab3c9:5432/db`) are now transparently rewritten to the canonical bracketed form (`[2406:da18:...:b3c9]`) before reaching `pg`, preventing `getaddrinfo ENOTFOUND` failures on the percent-encoded string. The decoded host is validated as a real IPv6 literal; anything else is passed through unchanged so downstream errors remain honest.

  `createManagedPool` also retries its eager-connect probe with bounded exponential backoff on transient errors (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, and its own timeout wrapper). Auth failures (`28P01`, `28000`), TLS negotiation errors, and `ENOTFOUND` still fail fast. Tunable via `PGDELTA_CONNECT_MAX_ATTEMPTS` (default 3), `PGDELTA_CONNECT_BASE_BACKOFF_MS` (default 250), and `PGDELTA_CONNECT_MAX_BACKOFF_MS` (default 1000).

- f2420d9: Improve procedure comment diffing, PostgreSQL 17 generated column handling, and Supabase "etl" schema filtering

## 1.0.0-alpha.13

### Patch Changes

- 5b8511b: fix(export): allow declarative schema export to accept raw integration DSL without requiring callers to precompile serialize rules

## 1.0.0-alpha.12

### Patch Changes

- b9c7ebe: fix(pg-delta): support serial and identity transition diffs for table columns
- d15eb48: fix(sort): order FK-related table drops and publication table removals before dependent destructive operations
- e065101: Fix Supabase declarative export for `pgmq` by allowing the integration serializer to omit `WITH SCHEMA` during extension creation, so exported schemas can be applied to a fresh database. Formalize serializer option typing with a shared `SerializeOptions` contract so integration DSL options and change serializers stay in sync.

## 1.0.0-alpha.11

### Patch Changes

- 8048cd9: Fix view diffs to drop and recreate views when the projected column list changes (for example when `SELECT *` views need to pick up a new base-table column), instead of emitting `CREATE OR REPLACE VIEW`.
- bb63513: fix(depend): order CREATE EXTENSION before CREATE INDEX when index uses extension-provided operator class
- 066683e: fix(pg-delta): order domain CHECK function dependencies before domain creation
- f2cd63e: Use normalized object snapshots when comparing extracted catalog objects for equality so semantically identical metadata does not produce false-positive diffs.

## 1.0.0-alpha.10

### Patch Changes

- 72dce37: Support PostgreSQL 18 table introspection for NOT NULL constraints and add pg18 test coverage.

## 1.0.0-alpha.9

### Patch Changes

- 505413e: Fix async pool session setup so declarative export no longer triggers concurrent `client.query()` deprecation warnings during catalog extraction.
- def35a5: Rename the declarative apply CLI flag for skipping final function validation to `--skip-function-validation`.

## 1.0.0-alpha.8

### Patch Changes

- d6c9f90: fix(plan): use catalog-shape guard instead of instanceof Catalog so deserialized catalogs work in edge/bundled runtimes (declarative sync)

## 1.0.0-alpha.7

### Minor Changes

- 28f6a9b: fix: export createManagedPool from lib core

## 1.0.0-alpha.6

### Patch Changes

- 7acf51b: fix(package): replace workspace protocol for pg-topo runtime dependency so npm releases resolve in Deno

## 1.0.0-alpha.5

### Minor Changes

- 2441e1c: Add `@supabase/pg-delta/catalog-export` subpath export for programmatic catalog export (extract, serialize, deserialize, createManagedPool) without pulling in the full package API.
- 646e6be: Fix duplicate role creation from different grantors
- f7de56c: fix correct order for grant/revoke
- bf47b8b: fix some invalid postgres syntax in serialize
- 2441e1c: feat: add declarative export/apply and catalog-export to pg-delta

### Patch Changes

- 9c445f1: fix(roles): skip self-granted memberships to avoid ADMIN option error on PG 17+
- Updated dependencies [2441e1c]
  - @supabase/pg-topo@1.0.0-alpha.1

## 1.0.0-alpha.4

### Minor Changes

- c267747: feat: add basic formatter to sql output

### Patch Changes

- 4f8faf3: fix(formatter): issue with EVENT TRIGGER clause
- 1dacd2a: Handle constraint triggers in table introspection and trigger updates

## 1.0.0-alpha.3

### Patch Changes

- bbf13d3: fix: add 'supabase_superuser' to roles filter
- f4b10f7: add cli_login_postgres to system roles

## 1.0.0-alpha.2

### Patch Changes

- c20112a: Fix sslmode=require connections to SSL-enforced databases
- 323f751: Fix support for using a different role after a connection is established. Migrate to "pg" for finer control over the connections.

## 1.0.0-alpha.1

### Major Changes

- f8614f1: Rework the public API exports

## 1.0.0-alpha.0

### Major Changes

- 88bdff0: Release alpha
