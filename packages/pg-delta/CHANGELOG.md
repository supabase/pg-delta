# @supabase/pg-delta

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
