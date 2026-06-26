# pg-delta-next porting gaps

Genuine coverage gaps surfaced by the per-test verification sweep (one subagent
per not-ported ledger entry), now PORTED as corpus scenarios.

## Outcome

**Final state: all 52 gaps closed; all 3 engine bugs fixed; `tests/expected-red.ts` is empty.**

- **51 ported & converging** — new corpus scenarios, green on postgres:17-alpine (47 converged immediately; 4 first reproduced the 3 engine bugs below and now converge after the fixes).
- **1 ported as a unit test** — the function-body apply-segmentation guard is not corpus-observable (both classifications apply identically), so it is pinned by `src/plan/function-body-transactionality.test.ts` instead.
- **Engine bugs surfaced — all FIXED** (were pinned in `tests/expected-red.ts`; now unpinned):
  1. `policy-dependencies--policy-using-references-new-view` (teardown) — **✅ FIXED** — a policy drop is no longer folded into its table's DROP (`suppressible: () => false`, like FK constraints), so an explicit `DROP POLICY` is ordered before the referenced view's drop. Unpinned; converges. (A cosmetic pass elides the explicit drop when the policy has no externally-dropped reference.)
  2. `publication-operations--all-tables-to-table-list` (forward) — **✅ FIXED** — the action emitter now emits replace-recreates before the added-creates loop, so a replaced publication's `CREATE … FOR TABLE` registers its inlined member in `producerOf` and the redundant standalone `ADD TABLE` is suppressed. Unpinned; converges.
  3. `type-ops--matview-composite-domain-chain` + `type-ops--multiple-types-complex-deps` (both) — **✅ FIXED** — domain CHECK now inlined into CREATE DOMAIN (rules/types.ts) and the composite-type→domain dependency edge now extracted (extract/dependencies.ts `comptype`), so create + teardown order correctly. Unpinned; both converge.
- **1 not corpus-observable** — the function-body-embeds-nontransactional-text apply-segmentation guard cannot be proven by corpus convergence; stays not-ported pending a unit test.

## aggregate-operations.test.ts

### aggregate comment creation depends on aggregate create order

- **Status:** ✅ ported & converges — corpus/aggregate-operations--create-with-comment
- **Why it was uncovered:** The test's schema transition is empty-schema -> aggregate + COMMENT ON AGGREGATE in ONE diff, forcing both a CREATE AGGREGATE and a COMMENT change into a single plan where the comment must be ordered after the aggregate. I grepped all of corpus/tests/src: the only COMMENT ON AGGREGATE is in corpus/aggregate-operations--comment/b.sql, but there the aggregate already exists in a.sql so its plan contains only the comment change. aggregate-operations--create goes empty -> aggregate with no comment. No scenario co-creates the aggregate and its comment together, so the new engine never proves (via apply ordering) that the comment is sequenced after the aggregate create. The sortChangesCallback itself is an engine-internal no-analog detail, but the co-create ordering behavior is real and unexercised.

## alter-table-operations.test.ts

### add column then create unique index on it

- **Status:** ✅ ported & converges — corpus/alter-table--add-column-then-unique
- **Why it was uncovered:** The old test adds a NEW column (email) AND a UNIQUE constraint referencing that same new column in one diff, so the planner must order ADD COLUMN before ADD CONSTRAINT (the dependency the test stresses). I opened the claimed cover constraint-ops--pk-unique-check: it adds PK/UNIQUE/CHECK constraints only on columns (id/email) that already exist in a.sql, so it never exercises the new-column->constraint-on-new-column ordering. column-add adds columns with no constraints; deferrable-unique/quoted-names add constraints on pre-existing columns; catalog-diff--table-with-constraints creates the whole table from empty. No corpus scenario combines a brand-new column with a UNIQUE constraint on that new column. The sortChangesCallback is planner-internal, but the underlying schema-state convergence (apply must create the column before constraining it) is a real, uncovered A->B behavior.

## catalog-diff.test.ts

### complex scenario with multiple entity drops

- **Status:** ✅ ported & converges — corpus/catalog-diff--drop-heterogeneous-schema
- **Why it was uncovered:** Claimed reason is false: corpus/catalog-diff--multi-entity-alter keeps the enum, domain, sequence, table, view (and procedure) present in BOTH a.sql and b.sql, so neither harness direction (a->b grows, b->a shrinks) ever DROPS a whole entity — it's an alter-down, not a drop-to-empty. The only drop-to-nothing scenario I found, corpus/mixed-objects--multi-schema-drop, drops only schemas + plain tables; no corpus scenario drops an enum, domain, sequence, view, or procedure entirely (verified by grep over all a.sql/b.sql pairs). The audited behavior — converging a fully populated heterogeneous schema down to empty in correct dependency order — is unexercised.

## default-privileges-edge-case.test.ts

### table creation with selective privilege grants should override default privileges

- **Status:** ✅ ported & converges — corpus/default-privileges-edge-case--selective-regrant
- **Why it was uncovered:** The test's distinctive behavior is: a table created under ALTER DEFAULT PRIVILEGES GRANT ALL, then REVOKE ALL + GRANT SELECT (to authenticated) + GRANT ALL (to service_role), forcing the engine to converge with a PARTIAL revoke (REVOKE DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE FROM authenticated) against the default-grant baseline. I opened every default-privileges-edge-case--*/b.sql and default-privileges-ordering--*: all only do full REVOKE ALL from a role (incl. the claimed-covering multi-role-revoke) — never a sub-ALL re-grant. The one partial-revoke scenario, privilege-operations--table-revoke-only (SELECT+INSERT -> SELECT, emits REVOKE INSERT), is on a pre-existing explicitly-granted table, not against the default-ALL auto-grant baseline combined with CREATE TABLE. acl-default-revoke.test.ts only covers full REVOKE of a built-in PUBLIC default. The claimed "complex variant of multi-role-revoke" reason is wrong: multi-role-revoke has no partial revoke.

### default privileges edge case with schema-specific setup

- **Status:** ✅ ported & converges — corpus/default-privileges-edge-case--custom-schema-table-revoke
- **Why it was uncovered:** The distinguishing behavior is default privileges active in a CUSTOM (non-public) schema (`app`), then a table created in that schema with a default-granted role explicitly REVOKEd, converging in one roundtrip. The only corpus scenario doing create-table+REVOKE against active default privileges is default-privileges-edge-case--table-create-and-revoke, but it uses the public schema. Custom-schema default-priv scenarios (default-privileges-ordering--new-schema-and-default-privs, privilege-operations--default-privileges-for-role-in-schema) only test ADP ordering/grants and never create a table + revoke on it. compaction.test.ts uses the `app` schema but with explicit GRANTs, never default-privilege-derived baselines. The per-schema defaclnamespace ACL baseline + schema-qualified REVOKE path is not exercised end-to-end anywhere.

## dependencies-cycles.test.ts

### replace-dependency DropTable + AlterTableDropColumn on same table should not cycle

- **Status:** ✅ ported & converges — corpus/dependencies-cycles--enum-replace-dependent-table-drops-fk-col
- **Why it was uncovered:** This is a real A->B convergence behavior (uses roundtripFidelityTest, not a statement-count/no-op assertion): the cycle only arises when a SINGLE table is both an enum-replace dependent (gets expansion-added DropTable+CreateTable because a referenced enum lost a label) AND has its own FK column dropped in the same diff (forcing AlterTableDropColumn + the catalog FK edge that closes the cycle). I opened every enum-bearing corpus dir; the closest, mixed-objects--enum-replace-with-dependents, replaces an enum with dependent tables (tasks/task_history) but those tables are byte-identical between a.sql and b.sql, so no AlterTableDropColumn is emitted on a replaced table and the specific cycle is never constructed. type-ops--enum-replace-values has no table at all. No next integration/unit test reproduces the combination either, and pg-delta-next's expandReplacements (src/plan/phases/replacement-expansion.ts) is a from-scratch reimplementation, so the convergence is unproven for this case.

### drop publication FK-chain tables with partial publication membership should not produce a cycle

- **Status:** ✅ ported & converges — corpus/dependencies-cycles--drop-publication-fk-chain-partial-membership
- **Why it was uncovered:** The claimed cover, corpus dir dependencies-cycles--drop-publication-fk-chain-tables, has ALL three FK-chain tables (labs/posts/post_attachments) as publication members. The audited test deliberately exercises the OPPOSITE twist: the intermediate FK-chain table (trade_status_events) is NOT a publication member, which is precisely the condition that broke the old "every dropped table must be a publication member" cycle breaker (Sentry SUPABASE-API-7RS / CLI-1605). No corpus dir or next test (grep for trade_status_events/public_offering_events returns nothing; no publication with a partial FK-chain membership exists) exercises this partial-membership shape, so the regression behavior is not covered.

### drop SERIAL sequence on table replaced via dependent enum should not produce DropSequence ↔ DropTable cycle

- **Status:** ✅ ported & converges — corpus/dependencies-cycles--enum-replace-drops-serial-on-promoted-table
- **Why it was uncovered:** The old test asserts convergence (roundtripFidelityTest) for one combined A→B transition: an enum loses a label (DropEnum+CreateEnum) which via replacement-expansion promotes a dependent table to DropTable+CreateTable, WHILE that same table's SERIAL/OWNED-BY sequence is dropped, closing a DropSequence↔DropTable 2-cycle. In pg-delta-next the two halves exist only separately: dependencies-cycles--drop-serial-col-surviving-table drops a SERIAL column on a surviving table (no enum, no table-replacement promotion), and mixed-objects--enum-replace-with-dependents / type-ops--enum-replace-values do enum-label removal but every dependent table uses 'id INTEGER', never SERIAL. I confirmed via grep that the corpus files containing SERIAL and those containing 'AS ENUM' are entirely disjoint, so the specific combination that produced the production CycleError is exercised nowhere. The claimed reason ('not representable as a simple a→b snapshot') is wrong — the old test is itself a single a→b snapshot.

## foreign-data-wrapper-operations.test.ts

### alter server owner

- **Status:** ✅ ported & converges — corpus/foreign-data-wrapper-operations--alter-server-owner
- **Why it was uncovered:** Old test does a roundtrip on `ALTER SERVER test_server OWNER TO server_owner`. pg-delta-next has the capability (src/extract/foreign.ts extracts srvowner + pushOwnerEdge; src/plan/rules/foreign.ts:64 server.ownerAlterPrefix emits `ALTER SERVER <name>`), but NO corpus scenario or test flips a foreign server's owner: all FDW corpus dirs (alter-server-options, version via fdw rules, full-lifecycle, user-mapping) change options/version/lifecycle only, and every `OWNER TO` corpus scenario targets other kinds (table, view, schema, type, aggregate, publication, event-trigger). Owner serialization is per-kind (the ALTER prefix differs), so those do not exercise the SERVER path. Claimed "covered by owner-change pattern elsewhere" is unverified for this object kind.

### alter server version

- **Status:** ✅ ported & converges — corpus/foreign-data-wrapper-operations--alter-server-version
- **Why it was uncovered:** The old test transitions an existing server's VERSION field (CREATE SERVER with no version -> ALTER SERVER ... VERSION '2.0'). I opened every server/FDW corpus dir: alter-server-options changes only OPTIONS (srvoptions), create-server-with-options only creates/drops a server (with a static VERSION '1.0', no transition), and full-lifecycle never sets/changes a version. No next integration or unit test exercises ALTER SERVER ... VERSION. The claimed equivalence to alter-fdw-options is wrong — srvversion and srvoptions are distinct catalog fields emitting different DDL, so options coverage does not prove the version field diffs/converges.

### alter user mapping options

- **Status:** ✅ ported & converges — corpus/foreign-data-wrapper-operations--alter-user-mapping-options
- **Why it was uncovered:** The old test exercises an ALTER USER MAPPING transition (existing mapping with user='remote_user' -> ADD password + SET user), producing ALTER USER MAPPING ... OPTIONS (SET user 'new_user', ADD password '__OPTION_PASSWORD__') with redaction on the ADDed secret. The cited fdw-option-secret-redaction--multi-layer-fdw-schema (empty->full) and sensitive-handling--user-mapping-options (no-mapping->mapping) are both CREATE-only scenarios; reverse direction is DROP. tests/redaction-output.test.ts also drives only the CREATE path (empty src -> full tgt). rg "ALTER USER MAPPING" over corpus returns none, and no corpus dir has a user mapping in BOTH a.sql and b.sql. The production ALTER-options path exists (src/plan/rules/foreign.ts:108) but no diff/convergence scenario drives ALTER USER MAPPING option redaction (SET non-secret + ADD secret).

### alter foreign table owner

- **Status:** ✅ ported & converges — corpus/foreign-table-operations--owner-change
- **Why it was uncovered:** The old test asserts roundtrip convergence of `ALTER FOREIGN TABLE ... OWNER TO <role>`. pg-delta-next has the production plumbing (src/extract/foreign.ts:135 pushes an owner edge for foreignTable; src/plan/rules/foreign.ts:142 supplies an `ownerAlterPrefix` emitting `ALTER FOREIGN TABLE ... OWNER TO`), but NO corpus scenario or test drives a foreign-table owner change. Every foreign-table corpus dir (alter-options, column-alters, full-lifecycle, constraints--add-check) leaves owner unchanged (no OWNER/CREATE ROLE in any a.sql/b.sql), and the existing owner-change corpus dirs (ordering-validation--table/schema/type-owner-change, event-trigger-operations--owner-and-comment) cover other kinds, not foreignTable. The claimed analog "alter server owner" is also not exercised by any corpus. Bias toward gap: cannot confirm a scenario matching object kind (foreignTable) + operation (owner change).

## function-operations.test.ts

### keeps functions whose bodies embed non-transactional SQL text in one transactional unit

- **Status:** ⚠️ NOT corpus-observable (apply-segmentation) — needs a unit test; stays not-ported
- **Why it was uncovered:** The old test is a false-positive guard: a CREATE FUNCTION whose dollar-quoted body embeds the TEXT "CREATE INDEX CONCURRENTLY"/"VACUUM FULL"/"work_mem" must NOT be misclassified as non-transactional — the plan must stay one transactional unit. The claimed covering tests do not match: tests/apply-nontransactional.test.ts only checks apply-side session reset + inDoubt for a hand-built failing nonTransactional action (no function bodies), and tests/execution.test.ts "concurrentIndexes" asserts a GENUINE CREATE INDEX CONCURRENTLY is correctly nonTransactional (the opposite direction). Grepping corpus/ for CONCURRENTLY/VACUUM FULL/work_mem returns zero hits; no function-ops corpus scenario embeds non-tx keywords in a body. The new engine declares transactionality per-rule (routines.ts never sets it, so it defaults transactional), which makes the regression structurally unlikely, but nothing actually exercises the embedded-keyword case.

### begin atomic sql function replacement

- **Status:** ✅ ported & converges — corpus/function-ops--begin-atomic-replacement
- **Why it was uncovered:** The old test replaces a LANGUAGE SQL function defined with a standard-conforming BEGIN ATOMIC body (prosqlbody, PG14+) that references a real table (test_schema.accounts), extending the body via CREATE OR REPLACE. I confirmed zero coverage of BEGIN ATOMIC anywhere in pg-delta-next: direct grep over corpus/, tests/, and src/ returned no matches (the only "atomic" hits are file-loading atomicity, unrelated). The claimed cover function-ops--replacement (corpus/function-ops--replacement/{a,b}.sql) uses a string AS '...' body (prosrc) with no table dependency, so it does not exercise the BEGIN ATOMIC body form. Because next extracts functions via pg_get_functiondef(p.oid) into a single def payload (src/extract/routines.ts:21), atomic bodies are canonicalized through a different code path whose roundtrip fidelity under replacement (parsed statement list + the function->table pg_depend edge) is never proven by any scenario.

### function with complex attributes

- **Status:** ✅ ported & converges — corpus/function-ops--complex-attributes
- **Why it was uncovered:** The old test roundtrips a CREATE FUNCTION carrying PARALLEL RESTRICTED STRICT COST 1000. In pg-delta-next, regular functions are extracted as the opaque pg_get_functiondef string (src/extract/routines.ts:21,49) and created verbatim (src/plan/rules/routines.ts:38-54), so these attributes ride inside `def` automatically — but I opened every function-ops corpus dir and grepped all corpus a/b.sql plus next tests, and no scenario or test puts a regular function carrying PARALLEL/STRICT/COST through a diff. The closest dirs (function-ops--simple-create, function-ops--replacement) only exercise IMMUTABLE; the only PARALLEL handling in plan/rules and the only PARALLEL corpus (aggregate-operations--definition-options) are for AGGREGATES, not functions. A regression in pg_get_functiondef roundtrip for a COST/STRICT/PARALLEL function would not be caught.

### function with configuration parameters

- **Status:** ✅ ported & converges — corpus/function-ops--set-config
- **Why it was uncovered:** The old test roundtrips a CREATE FUNCTION carrying two SET config clauses (SET work_mem TO '256MB', SET statement_timeout TO '30s'). pg-delta-next models functions as an opaque pg_get_functiondef string (src/extract/routines.ts: payload.def), so SET clauses ride inside def with no dedicated handling — meaning the only failure mode is a normalization/convergence mismatch on re-extract. I opened every function corpus scenario (function-ops--simple-create, --replacement, etc.) and grepped corpus + src + tests for "SET ... TO"/proconfig/work_mem/search_path: zero hits. No scenario exercises a function whose def includes SET attributes, so the SET-clause roundtrip is not proven anywhere; the claimed "not-ported — SET clause attributes" reason checks out.

### plpgsql function body references are accepted even when helper is created later

- **Status:** ✅ ported & converges — corpus/function-ops--plpgsql-body-forward-ref
- **Why it was uncovered:** The old test asserts a real A->B convergence: empty schema -> two plpgsql functions where a_wrapper's BODY calls z_helper_parse (created later). plpgsql bodies create NO pg_depend edge, so this is distinct from the pg_depend-backed cases. The claimed cover (table-fn-circular--*) is wrong: I opened table-fn-circular--complex-multi-table/setof-and-default/with-matview and they only exercise table<->function deps via DEFAULT/SETOF (real pg_depend edges), never a function-to-function body reference. function-ops--dependency-ordering covers CHECK/view function refs, not cross-function plpgsql bodies. grep over corpus for "RETURN (test_schema|public).fn(" in any LANGUAGE plpgsql file found zero matches, and no next test references plpgsql or check_function_bodies behavior. The new engine does bake check_function_bodies=off into every plan preamble (plan.ts:251), which makes the behavior structurally likely, but no concrete scenario actually exercises an unvalidated cross-function body reference, so it is unverified.

### sql function body references are protected by check_function_bodies setting

- **Status:** ✅ ported & converges — corpus/function-ops--sql-body-cross-reference
- **Why it was uncovered:** The plan.statements[0] assertion is by-design (next puts check_function_bodies=off unconditionally in plan.preamble, applied in src/apply/apply.ts:175 — verified). But the test's real behavior is a SQL-language function whose BODY calls another SQL function created LATER (a_wrapper -> z_helper_parse). LANGUAGE sql string bodies record no pg_depend edge for called functions, so the engine cannot topologically order them; convergence relies entirely on check_function_bodies=off. I opened every corpus scenario with 2+ functions (function-ops--dependency-ordering, table-fn-circular--complex-multi-table, aggregate-operations--definition-options, table-fn-circular--setof-and-default, function-ops--overloads) and none has a function body that references another user-defined function — they reference tables/views/CHECK/defaults, which DO have pg_depend edges. So no scenario actually exercises the order-independent cross-referencing-SQL-functions case the preamble guards.

## index-operations.test.ts

### drop implicit dependent table index

- **Status:** ✅ ported & converges — corpus/index-operations--drop-table-cascades-index
- **Why it was uncovered:** The old test drops a table (test_schema.test_table) carrying a standalone, non-constraint CREATE INDEX (test_table_name_index) and roundtrip-asserts convergence with no separate DROP INDEX (the index cascades with DROP TABLE). I scanned every corpus dir: scenarios that drop tables (dependencies-cycles--*, sequence-operations--drop-table-with-owned-sequence) only cascade constraints/PK-indexes/sequences/FKs, never a plain secondary CREATE INDEX; index-operations--drop and the index/ + btree scenarios drop only the index while the table survives. No corpus scenario has a.sql containing CREATE INDEX on a table that is absent in b.sql (the table-drop-with-index probe returned nothing), and no next/unit test exercises this cascade. The claimed reason ("asserts plan mechanics; no standalone index-state change") is wrong: this is a real A->B convergence behavior (elide the redundant index drop), not a statement-count assertion.

## materialized-view-operations.test.ts

### materialized view with joins

- **Status:** ✅ ported & converges — corpus/materialized-view-operations--joins
- **Why it was uncovered:** The claimed cover `materialized-view-operations--create` is a single-table matview (SELECT id,name,email FROM users WHERE active) with no join, no second base table, no aggregate. The "joins" test creates a matview whose definition LEFT JOINs two tables (customers, orders) with GROUP BY + COUNT/COALESCE/SUM, so it depends on TWO base tables and round-trips join/coalesce mvdef. I grepped the entire corpus and pg-delta-next tests/src: zero scenarios contain a JOIN, and the only aggregate matview scenario (--with-dependent-index-and-view) still depends on a single base table. The multi-table matview dependency closure is unexercised.

## mixed-objects.test.ts

### schema comments

- **Status:** ✅ ported & converges — corpus/comments--schema
- **Why it was uncovered:** The claimed cover is false: corpus/comments/ only exercises COMMENT ON TABLE and COMMENT ON COLUMN on public.docs (read a.sql/b.sql), never COMMENT ON SCHEMA. A case-insensitive grep for "comment on schema" across all of corpus/, tests/, and src/ returns no deterministic scenario; the only emitter is tests/generative/generator.ts:260 (randomized fuzzing, not a reproducible A->B scenario). The engine does extract schema comments (src/extract/schemas.ts:19), but no deterministic corpus scenario adds/changes/drops one.

## partitioned-table-operations.test.ts

### partitioned table with unique constraint including partition key

- **Status:** ✅ ported & converges — corpus/partitioned-table-operations--parent-unique-with-partition-key
- **Why it was uncovered:** The behavior is adding a UNIQUE constraint to a partitioned PARENT (ADD CONSTRAINT products_sku_key UNIQUE (sku, created_on)) which Postgres auto-propagates to every partition; the diff must emit the parent ALTER and not generate spurious per-partition constraint/index changes. I confirmed the claimed reason is false: of the corpus partition dirs (partitioned-table-operations--*, table-ops--{partition-range,attach-partition,detach-partition}) none contain UNIQUE (rg found 0), and the comprehensive-all-features scenario only adds FK/indexes/triggers, never a UNIQUE. The constraint-ops UNIQUE scenarios I opened (constraint-ops--pk-unique-check/b.sql, constraint-ops--deferrable-unique/b.sql) are both on plain non-partitioned tables. No next integration/unit test combines partition + unique either.

## policy-dependencies.test.ts

### policy expression references a new view

- **Status:** ✅ FIXED & converges — corpus/policy-dependencies--policy-using-references-new-view (was a pinned engine bug; fixed by never folding policy drops — see Bug 1)
- **Why it was uncovered:** The old test asserts a new view (referenced by a policy USING subquery `SELECT id FROM app.active_accounts`) is created before the policy. No pg-delta-next corpus dir or test pairs a VIEW with a POLICY (confirmed: `grep` for files containing both VIEW and POLICY returns none; no test references active_accounts or policy+view). The claimed covering corpus scenarios policy-using-exists-new-table (references a table whole-relation, objsubid=0) and policy-using-calls-new-function exercise the generic policy->referenced-object pg_depend edge, but neither hits the distinct view-column resolution path in dependencies.ts line 238 (objsubid>0 on a relkind 'v'/'m' relation -> resolve to the view relation via pg_rewrite). A policy referencing a view column goes through that fallback, which the existing policy scenarios do not exercise, so the view-before-policy ordering is not actually proven anywhere.

## privilege-operations.test.ts

### default privileges grant option addition

- **Status:** ✅ ported & converges — corpus/default-privileges-edge-case--grant-option-addition
- **Why it was uncovered:** The test transitions an existing default-priv entry from `GRANT SELECT ON TABLES` to `... WITH GRANT OPTION`, flipping the grantable bit on a `defaultPrivilege` fact (modeled at src/extract/roles.ts:58,66,82). No corpus dir or next test exercises this: privilege-operations--default-privileges-for-role-in-schema only covers no-priv->grant (the plain "default privileges grant" test), and privilege-operations--with-grant-option toggles grant-option on a regular TABLE ACL, not a pg_default_acl entry. Grepping all corpus/default-privileges-*/*.sql for GRANT OPTION/grantable returns nothing, so the grant-option transition on the defaultPrivilege fact/diff path is unproven.

### default privileges grant option downgrade

- **Status:** ✅ ported & converges — corpus/default-privileges-edge-case--grant-option-downgrade
- **Why it was uncovered:** The old test asserts roundtrip fidelity for downgrading a default-privilege ACL entry: initial ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT ... WITH GRANT OPTION, then REVOKE GRANT OPTION FOR INSERT (INSERT loses grant-option, SELECT keeps it). I grepped pg-delta-next corpus, tests/, and src/: "GRANT OPTION", "grantable", "grant_option", "withGrant" all return 0 matches everywhere. The closest corpus dirs (default-privileges-edge-case--table-revoke-after-default etc.) only revoke whole privileges from default-priv ACLs; none uses WITH GRANT OPTION nor downgrades grant-option to plain. Grant-option semantics on default privileges are exercised nowhere.

### mixed: create + grant, and drop unrelated object

- **Status:** ✅ ported & converges — corpus/privilege-operations--create-grant-drop-unrelated
- **Why it was uncovered:** The old test's distinctive behavior is a single A->B plan that must simultaneously CREATE a new role+schema+table, GRANT on the new table, AND DROP a completely unrelated pre-existing table (drop_s.old_t), exercising the DROP-phase / CREATE-phase split coexisting with a privilege grant. I opened every grant-related corpus dir (privilege-operations--create-grant-ordering, depend-extraction--rich-schema-with-privileges/acl-and-membership-edges, default-privileges-* , role-option--role-owned-table) plus mixed-objects--multi-schema-drop, and grepped the whole corpus: every create+grant scenario starts from an empty state A (so its forward direction never drops an unrelated object and its reverse is drop-only), and the only scenarios with both a grant and a differing table are revokes on the same created table, not an unrelated drop. No next integration/unit test references GRANT at all. The claimed reason ("combinatorial variant; capped at 6") is not a by-design category — this is a genuine convergence behavior not exercised anywhere.

### table-level privileges replaced by column-level privileges (revoke before grant ordering)

- **Status:** ✅ ported & converges — corpus/privilege-operations--table-to-column-privilege-swap
- **Why it was uncovered:** The test transitions a table with table-level GRANT INSERT,UPDATE for a role into column-level GRANT INSERT(a,b)/UPDATE(b) for the same role+table, requiring the table-level REVOKE to be ordered before the column GRANTs. I opened every privilege corpus dir: privilege-operations--column-privileges only ADDS a column grant (no table-level revoke), privilege-operations--table-revoke-only only REVOKEs a table privilege (no column grant), and table-grant/create-grant-ordering only add table grants. No single scenario (either direction) combines a table-level privilege revoke with a column-level grant for the same grantee+table, so the revoke-before-column-grant ordering behavior is unexercised. No next/unit test covers it either (grants are handled generically in plan/rules/helpers.ts with no targeted test). The claimed reason ("capped at 6") confirms intentional non-porting.

### view-level privileges replaced by column-level privileges (revoke before grant ordering)

- **Status:** ✅ ported & converges — corpus/privilege-operations--view-column-privileges
- **Why it was uncovered:** The behavior is a real A->B convergence: a VIEW with view-level SELECT,UPDATE grants becomes column-level grants (SELECT(a,b), UPDATE(b)), requiring REVOKE-before-GRANT ordering. pg-delta-next does NOT model column-level ACLs at all: extractColumns in src/extract/relations.ts never extracts a.attacl (grep for "attacl" across src/ and tests/ returns zero hits), and grantActions in src/plan/rules/helpers.ts only emits `GRANT priv ON target` with no column-list syntax. The cited analog corpus privilege-operations--column-privileges (only table-level, and the ledger's "ported" mapping for column grants) is itself a false positive: since column ACLs are invisible to the engine, A and B extract identically so it converges trivially without ever exercising a column grant. Views' relacl IS extracted (relations.ts:363), so the view-level REVOKE would be emitted but the column-level GRANTs never would, and re-extract is blind to them. No corpus or next test exercises column-level grants on a view (or even on a table for real).

### object-level privilege swap (revoke one, grant another)

- **Status:** ✅ ported & converges — corpus/privilege-operations--table-privilege-swap
- **Why it was uncovered:** Old test transitions a (table,role) grant from {INSERT} to {UPDATE}, so one diff direction must simultaneously REVOKE INSERT and GRANT a DIFFERENT privilege UPDATE for the same grantee. The claimed cover privilege-operations--table-revoke-only is A={SELECT,INSERT}<->B={SELECT}: each direction is a pure revoke OR pure grant of the same privilege, never a simultaneous swap of disjoint privileges. I opened every privilege-* corpus dir (table-grant=pure add/drop, column-privileges=column UPDATE add, with-grant-option=grant-option toggle, public-grantee=view grant, etc.) and none exercise revoke-one+grant-another on the same object/role in a single direction.

## publication-operations.test.ts

### publication dependency ordering

- **Status:** ✅ ported & converges — corpus/publication-operations--create-with-new-deps-cross-schema
- **Why it was uncovered:** The test's load-bearing behavior is co-creating a publication in the SAME migration as the brand-new schemas/tables it depends on (across two schemas, via both FOR TABLE and TABLES IN SCHEMA), forcing the planner to emit CREATE SCHEMA/CREATE TABLE before CREATE PUBLICATION. I opened every corpus dir with CREATE PUBLICATION: the only two that create a publication in the diff (publication-operations--create-for-tables-in-schema, --create-with-table-filters) already have the schema+tables present in a.sql, so the publication is created in isolation, not alongside new deps. The dependencies-cycles--drop-publication-* scenarios exercise DROP ordering, not CREATE co-ordering. The sortChangesCallback scramble hook is genuinely by-design absent (engine derives its own order, proven by apply), but apply only catches a CREATE-ordering bug if a scenario actually co-creates a publication with new deps — none do, so the claimed "verified automatically by the harness" is unsupported.

### alter publication schema list

- **Status:** ✅ ported & converges — corpus/publication-operations--alter-schema-list
- **Why it was uncovered:** Old test keeps a publication alive while changing its SCHEMA membership ({pub_a} -> {pub_a, pub_b}), exercising the standalone publicationSchema add/drop path. I opened both corpus dirs in the claimed reason: create-for-tables-in-schema (corpus/publication-operations--create-for-tables-in-schema) only creates/drops the whole publication (the schema member is inlined into CREATE PUBLICATION; reverse is DROP PUBLICATION), and add-and-drop-tables exercises publicationRel (FOR TABLE) ADD/DROP, not schemas. src/plan/rules/publications.ts has a publicationSchema rule whose create emits "ALTER PUBLICATION ... ADD TABLES IN SCHEMA" and drop emits "ALTER PUBLICATION ... DROP TABLES IN SCHEMA", but no corpus/integration scenario keeps a publication surviving while adding/removing a schema, so that ADD/DROP TABLES IN SCHEMA path is never exercised end-to-end.

### switch publication from all tables to specific list

- **Status:** ✅ FIXED & converges — corpus/publication-operations--all-tables-to-table-list (was a pinned engine bug; fixed by emitting replaces before added-creates — see Bug 2)
- **Why it was uncovered:** The old test transitions a publication from FOR ALL TABLES (pg_publication.puballtables=true, no pg_publication_rel rows) to FOR TABLE pub_test.metrics (puballtables=false with an explicit table list) — a distinct catalog state requiring drop+recreate since there is no in-place ALTER. I dumped all 11 publication-operations--* corpus dirs and grepped corpus/tests/src: every publication uses FOR TABLE or FOR TABLES IN SCHEMA, and `grep -rli "ALL TABLES"` returns zero matches anywhere in pg-delta-next. The "all-tables -> specific-list" puballtables-flag-flip behavior is never exercised; the claimed implicit drop+create coverage never sets puballtables=true.

## rls-operations.test.ts

### policy comments

- **Status:** ✅ ported & converges — corpus/rls-operations--policy-comment
- **Why it was uncovered:** The old test roundtrips `COMMENT ON POLICY owner_only ON app.docs IS '...'` (adding a comment to an RLS policy). I grepped the entire pg-delta-next corpus and tests: there is NO `COMMENT ON POLICY` anywhere (confirmed via `grep -rhoE "COMMENT ON [A-Z]+" corpus` — covered kinds are AGGREGATE/COLLATION/COLUMN/CONSTRAINT/EVENT/FUNCTION/INDEX/MATERIALIZED/PROCEDURE/PUBLICATION/SUBSCRIPTION/TABLE/TRIGGER, but not POLICY). The claimed covering `comments/` corpus dir (corpus/comments/a.sql,b.sql) only exercises TABLE and COLUMN comments. tests/extract.test.ts models a policy but only asserts its cmd/usingExpr payload, never a comment. The 13 separate per-kind COMMENT ON scenarios show comments are wired per object kind, so policy comments are not transitively covered by the generic table/column case.

## role-membership-dedup.test.ts

### no diff when both sides have same membership from different grantors

- **Status:** ✅ ported & converges — corpus/role-membership-dedup--same-membership-different-grantors
- **Why it was uncovered:** The engine does dedup grantors (src/extract/roles.ts lines 36-53 GROUP BY role,member with bool_or(admin_option), grantor not in fact identity), and role-membership-dedup--multi-grantor forward (empty->two-grantors, single GRANT) proves the two-grantor state extracts to one fact. But that scenario's a.sql is empty: no corpus dir or test places the SAME membership on BOTH sides with DIFFERENT physical grantor-row counts and asserts no GRANT/REVOKE. That specific equivalence-under-differing-grantors idempotency (not a trivial A==B no-op) is unexercised; I confirmed all membership corpus dirs and found only multi-grantor has SET ROLE, and only in b.sql.

## rule-operations.test.ts

### rule comments

- **Status:** ✅ ported & converges — corpus/rule-operations--comment
- **Why it was uncovered:** The old test asserts convergence of `COMMENT ON RULE x ON table IS '...'`. pg-delta-next does support this (extract carries `obj_description(rw.oid,'pg_rewrite')` in relations.ts:441, and render.ts:72-73 has a rule-specific `case "rule": RULE name ON table` branch in commentTarget). But the claimed cover, corpus/comments/, only exercises TABLE and COLUMN comments — never a rule. Grepping all of corpus/tests/src returns zero matches for "COMMENT ON RULE", and none of the four rule-operations--* corpus dirs add/change a rule comment. The rule-specific render branch and the rule fact's comment metadata path are unexercised; a typo there would go uncaught.

### rule enable always state

- **Status:** ✅ ported & converges — corpus/rule-operations--rule-enable-always
- **Why it was uncovered:** The old test transitions a rule from DISABLE('D') to ENABLE ALWAYS('A') — a distinct enabled-state value with its own phrase. The only rule enable-state corpus dir, rule-operations--rule-enabled-state, flips ENABLED('O') <-> DISABLED('D') only; grepping corpus+tests for ENABLE ALWAYS/REPLICA RULE returns 0 matches. The engine CAN serialize 'A' (src/plan/rules/helpers.ts:336 enabledPhrase, wired via views.ts:114 enabled.alter, extract reads rw.ev_enabled), but enabledPhrase's default arm returns plain "ENABLE", so a regression conflating 'A' with 'O' would not be caught. The claimed reason ("roundtrip covers both from the enabled-state scenario") is false for the ALWAYS state.

## sequence-operations.test.ts

### sequence comments

- **Status:** ✅ ported & converges — corpus/sequence-operations--comment
- **Why it was uncovered:** The claimed cover (corpus/comments/) only does COMMENT ON TABLE/COLUMN (verified a.sql/b.sql) — no sequence object at all. Grepping all of pg-delta-next corpus, tests, and src for "COMMENT ON SEQUENCE" / sequence comment returns zero hits; the many sequence corpus dirs (sequence-operations--*, catalog-diff--create-sequence, etc.) contain no COMMENT statements. Sequence comments route through a sequence-specific comment change, so generic table/column comment coverage does not exercise this behavior.

## trigger-operations.test.ts

### constraint trigger update

- **Status:** ✅ ported & converges — corpus/trigger-operations--constraint-trigger-deferrability-change
- **Why it was uncovered:** The old test keeps the SAME constraint trigger on both sides and only changes its deferrability (non-deferrable -> DEFERRABLE INITIALLY DEFERRED), forcing a drop+recreate-on-modify. The claimed cover, corpus/trigger-operations--constraint-trigger-create, has no trigger in a.sql and a DEFERRABLE INITIALLY IMMEDIATE trigger in b.sql, so its two directions only exercise create and drop — neither side has the trigger present-but-different, so the modify/replace transition is never exercised. grep for CONSTRAINT TRIGGER/DEFERRABLE/INITIALLY across all of pg-delta-next corpus, tests, and src returns zero matches. The engine extracts triggers via pg_get_triggerdef (extract/relations.ts:394) which would include the deferrability clause, but no scenario proves convergence of a deferrability change.

### trigger replacement (modification)

- **Status:** ✅ ported & converges — corpus/trigger-operations--trigger-event-modification
- **Why it was uncovered:** The claimed reason is inaccurate: the old test uses roundtripFidelityTest (apply + re-extract), not statement-snapshot internals. Its real behavior is a trigger present on BOTH sides whose definition changes (BEFORE INSERT -> BEFORE INSERT OR UPDATE), forcing a DROP+CREATE trigger replacement, plus a CREATE OR REPLACE FUNCTION body change. The function-body half is covered by corpus function-ops--replacement, but I found no corpus scenario or next test that changes an existing trigger's definition: the only dirs with a trigger on both sides are trigger-update-of-column-numbers--attnum-regression (identical def), trigger-operations--trigger-comment (only adds a comment), and partitioned-table-operations--add-partition-to-existing (identical trigger). None exercise trigger event/timing modification convergence.

### drop all triggers before dropping shared trigger function

- **Status:** ✅ ported & converges — corpus/trigger-operations--shared-function-multi-trigger-drop
- **Why it was uncovered:** The claimed covering dir trigger-operations--trigger-drop-before-function-drop (opened: a.sql has ONE trigger foo_insert on ONE table referencing test_schema.bar(); b.sql drops both) only exercises a single trigger dependent on the function. The audited test asserts the fan-in shape: TWO triggers (foo_insert on foo, bar_insert on bar) sharing ONE function, where ALL dependent triggers must be dropped before the shared function. The two other 2-trigger corpus dirs (instead-of-trigger-on-view, partitioned comprehensive) use distinct functions per trigger and never drop the functions, so none exercise multi-dependent shared-function drop ordering. No next/unit test references triggers at all. The claim that the variant "adds no new state shape" is wrong: one-dependent vs many-dependent drop-closure is a distinct convergence shape.

## type-operations.test.ts

### domain CHECK dependency coexists with function using the domain type

- **Status:** ✅ ported & converges — corpus/type-ops--domain-fn-param-type
- **Why it was uncovered:** The old test asserts a 3-link create-order chain: check_prefix function -> user_id domain (CHECK calls the function) -> normalize_user_id function (takes the domain as a PARAMETER TYPE). Of these, only the function<-domain-CHECK edge is exercised, by corpus domain-operations--check-references-replaced-function (its function is called by the domain CHECK). The distinct edge "a function whose parameter type is a user-defined domain requires the domain first" is exercised nowhere: that corpus dir and every other (type-ops--domain-with-check, catalog-diff--domain-add-constraint) have no function consuming a domain/type as a param, and no next integration/unit test references domains at all. The claimed reason (findIndex ordering is engine-internal) is only half-right — apply+converge would prove the ordering, but the underlying schema state is simply not present in any scenario.

### multiple types complex dependencies

- **Status:** ✅ FIXED & converges — corpus/type-ops--multiple-types-complex-deps (was a pinned engine bug; fixed by the composite-type→domain dependency edge — see Bug 3)
- **Why it was uncovered:** The old test builds a type-on-type dependency: composite `commerce.product_info` has an attribute `unit_price commerce.price` where `price` is a DOMAIN, so the domain must be ordered before the composite (and dropped after, reversed). The claimed dir `type-ops--types-with-table-deps/b.sql` does NOT match: its enum/domain/composite are all independent and the composite `address` has only TEXT fields — only table->type edges exist, never type->type. No other corpus dir (composite-create, domain-with-check, check-ordering--function-and-type-ref) or next integration/unit test exercises a composite attribute typed as a domain/custom type. The composite-on-domain ordering behavior is unexercised.

### type name with special characters

- **Status:** ✅ ported & converges — corpus/type-ops--special-char-names
- **Why it was uncovered:** The old test is a roundtrip of CREATE TYPE (enum) + CREATE DOMAIN where the schema AND the type/domain names contain hyphens, exercising correct identifier quoting for type/domain DDL. The claimed cover constraint-ops--quoted-names (opened: a.sql/b.sql) only quotes a table/schema/column/CHECK-constraint name — wrong object kind, no type or domain. type-ops--enum-create and type-ops--domain-with-check exercise enum/domain create+converge but with plain identifiers (test_schema.mood, test_schema.positive_int), no special characters. rg over corpus and tests/src found zero CREATE TYPE/DOMAIN with quoted/special-char names. So the quoted-type/domain behavior is exercised nowhere in pg-delta-next.

### materialized view with enum dependency

- **Status:** ✅ ported & converges — corpus/type-ops--matview-enum-dependency
- **Why it was uncovered:** The old test roundtrips a matview whose output column (GROUP BY status) carries an enum type, creating a matview->enum pg_depend edge that must order the enum before the matview on create and after on drop. No corpus dir combines MATERIALIZED VIEW with CREATE TYPE ... ENUM (verified by scanning every corpus/*/*.sql). The matview corpus (materialized-view-operations--create/drop, table-fn-circular--with-matview) uses only plain/text columns; mixed-objects--enum-replace-with-dependents pairs an enum with a plain VIEW, not a matview; and depend-edges-oracle.test.ts asserts only materializedView:...->column edges, never materializedView:...->type. The "covered transitively" claim is unverifiable: the matview->enum-type ordering edge is a distinct dependency path not exercised anywhere.

### materialized view with domain dependency

- **Status:** ✅ ported & converges — corpus/materialized-view-operations--with-domain-dependency
- **Why it was uncovered:** The old test is a roundtripFidelityTest proving convergence of a matview that transitively depends on a domain via its underlying table (domain financial.currency -> table financial.transactions(amount financial.currency) -> matview on that table). No corpus scenario combines all three: table-fn-circular--with-matview has matview+table but no domain; type-ops--types-with-table-deps has domain+table but no matview; materialized-view-operations--create has matview+table but no domain; complex-dependency-ordering--ecommerce-schema has a matview but no domain in the chain. depend-edges-oracle.test.ts has both a domain (app.pos on users.qty) and a matview (app.order_counts on orders) but in SEPARATE chains, and it is an edge-snapshot extraction test, not a roundtrip-convergence test run through the proof loop. The engine.test.ts proof loop runs corpus scenarios in both directions, so this is where the behavior belongs and it is absent.

### materialized view with composite type dependency

- **Status:** ✅ ported & converges — corpus/type-ops--matview-on-composite-type
- **Why it was uncovered:** The old test is a roundtrip A->B (create + cascade-drop both directions) of: composite type inventory.address, a table column of that composite type, and a MATERIALIZED VIEW that reads composite fields via (location).city / (location).zip_code — establishing a matview->composite-type dependency edge distinct from matview->table. I opened every composite/matview corpus dir: type-ops--types-with-table-deps has composite+table but no matview; table-fn-circular--with-matview and materialized-view-operations--* have matviews only on plain tables; complex-dependency-ordering--ecommerce-schema has matviews + enums but its matview reads plain tables, not a composite type. grep over all corpus *.sql found no matview body using composite field access, and no next test references this scenario. No cap-6 doc justifies the exclusion.

### complex mixed dependencies with materialized views

- **Status:** ✅ FIXED & converges — corpus/type-ops--matview-composite-domain-chain (was a pinned engine bug; fixed by inlining domain CHECK + the composite-type→domain dependency edge — see Bug 3)
- **Why it was uncovered:** The old test is a pure roundtripFidelityTest (no expectedSqlTerms/assertions) creating ENUM + DOMAIN(CHECK) + a composite type whose attribute is the domain (base_price ecommerce.price) + tables with composite/enum/domain-typed columns + materialized views that select composite field-access (info).name/(info).base_price. I opened the closest corpus dirs: type-ops--types-with-table-deps has enum+domain+composite as table columns but no matview, no composite-uses-domain, no field access; complex-dependency-ordering--ecommerce-schema has a matview over tables but uses only plain text/decimal columns (no custom types, no composite field access); the materialized-view-operations--* and table-fn-circular--with-matview scenarios all use plain-typed tables. No single scenario exercises the matview -> table -> composite-column -> composite-type -> domain dependency chain with composite field access.

### drop type with materialized view dependency

- **Status:** ✅ ported & converges — corpus/type-ops--enum-table-matview-drop
- **Why it was uncovered:** The old test exercises a three-link teardown chain: enum type -> table column using it -> materialized view on that table, dropping all three. I opened the closest corpus scenarios and none combines all three links: type-ops--types-with-table-deps has enum/domain/composite types backing table columns but NO matview; table-fn-circular--with-matview and materialized-view-operations--drop have table+matview but NO custom type in the chain; mixed-objects--enum-replace-with-dependents uses an enum + a plain VIEW (not matview) and is a replace, not a drop. No next integration/unit test references MATERIALIZED VIEW (all matview coverage is corpus-only). The claimed reason holds for matview-drop and type-drop individually but not for the transitive ordering where the type is kept alive only through a table column that is simultaneously pinned by a matview.

### materialized view with range type dependency

- **Status:** ✅ ported & converges — corpus/type-ops--matview-range-dependency
- **Why it was uncovered:** The claimed reason (covered by type-ops--range-create) is false: I opened corpus/type-ops--range-create (a.sql/b.sql) and it only creates a bare range type with NO table and NO matview. type-ops--range-used-in-table adds a range-typed table column but has no matview. The matview corpus dirs (materialized-view-operations--create, table-fn-circular--with-matview, with-dependent-index-and-view) only build matviews over built-in-typed columns. No corpus scenario or next test combines a user-defined RANGE type, a table column of that range type, and a materialized view referencing it (via upper()/lower()) — the exact dependency chain (type->table->matview plus matview->range-type-functions) this old roundtrip asserts.

### type comments

- **Status:** ✅ ported & converges — corpus/type-ops--type-comments
- **Why it was uncovered:** The test roundtrips COMMENT ON ENUM, COMMENT ON DOMAIN, and COMMENT ON composite TYPE. The claimed cover (comments/ corpus) only sets table+column comments (comments/a.sql,b.sql) — no COMMENT ON TYPE/DOMAIN. rg over the entire corpus and tests/src found ZERO `COMMENT ON TYPE`/`COMMENT ON DOMAIN` statements. The type-ops--enum-create/domain-with-check/composite-create dirs create the types but contain no COMMENT. The engine extracts type comments (src/extract/types.ts obj_description) but no scenario diffs/converges one, so the behavior is unproven. sortChangesCallback is engine-specific scaffolding and rightly dropped, but the comment behavior has no analog.

## view-operations.test.ts

### valid recursive patterns are not flagged as cycles

- **Status:** ✅ ported & converges — corpus/view-operations--recursive-cte
- **Why it was uncovered:** The test roundtrips a view whose definition is a WITH RECURSIVE CTE (employee_hierarchy) and proves convergence. The new engine derives view edges only from pg_rewrite/pg_depend (src/extract/dependencies.ts rw/resolved CTEs), so a CTE self-reference can never fabricate a false cycle — that defect class is architecturally precluded. But the literal A->B convergence of a recursive-CTE view is not exercised: a precise search for "WITH RECURSIVE"/"RECURSIVE" across corpus/, tests/, and src/ returns zero matches, and the only view scenarios (view-operations--simple-create, view-operations--nested-three-levels) use plain non-recursive SELECTs. No covering scenario could be confirmed.

### view comments

- **Status:** ✅ ported & converges — corpus/view-operations--comment
- **Why it was uncovered:** Old test adds COMMENT ON VIEW to a regular view (relkind 'v'). The claimed cover, corpus materialized-view-operations--comment, only emits COMMENT ON MATERIALIZED VIEW (relkind 'm') and exercises the distinct `materializedView` branch of commentTarget (render.ts:38). The regular-view branch (render.ts:36-37, `VIEW ...`) is exercised by NO corpus scenario: rg over corpus found zero `COMMENT ON VIEW` and no CREATE VIEW dir also contains a COMMENT, and no unit/integration test asserts a comment on a non-materialized view. The two are different DDL keywords on different object kinds, so the matview scenario does not cover this behavior.

