/**
 * Allowlist of EXPECTED class-23 auto-seed skips in the corpus proof loop.
 *
 * The engine suite (`engine.test.ts`) runs every corpus scenario with
 * `provePlan({ autoSeed: true })`, which best-effort seeds each empty kept
 * table with `INSERT ... DEFAULT VALUES` so the data-preservation check has
 * teeth. A table whose every column is nullable/defaulted seeds cleanly; a
 * table with a NOT NULL-without-default / FK / unique / check column cannot be
 * seeded that way and the driver returns a class-23 SQLSTATE.
 *
 * A skip has one of two `reasonCode` shapes, both expected and both gated here:
 *   - a class-23 SQLSTATE (`23502` NOT NULL w/o default, `23503` FK, `23505`
 *     unique, `23514` check, …) — the insert was rejected; or
 *   - the synthetic sentinel `"no_row"` (NOT a SQLSTATE) — the insert RESOLVED
 *     but the row is absent from the final pre-apply snapshot: a BEFORE INSERT
 *     trigger returned NULL, a DO INSTEAD rule suppressed it, or an AFTER INSERT
 *     trigger deleted it (possibly while seeding a later table). rowCount is
 *     only the command tag, so persistence is judged by reconciling against
 *     that snapshot — nothing was actually seeded.
 * Both must be declared here, keyed precisely by
 * `{ scenario, direction, table, reasonCode }`, so a NEW unseedable table (or a
 * skip that silently appears in an unexpected scenario) fails the suite loudly
 * instead of quietly losing data-preservation coverage. Anything the seeder
 * classifies as `failed` (a raised exception, connection/permission error,
 * etc.) is never allowlistable and always fails the scenario.
 *
 * Maintenance: the harness prints a machine-readable `SEED_AUDIT {json}` line to
 * stderr for every non-allowlisted skip before failing. Add the reported
 * `{ scenario, direction, table, reasonCode }` here (keep the list sorted by
 * scenario, then direction, then schema.name) only after confirming the table
 * is genuinely unseedable-with-defaults — never to paper over a `failed`
 * outcome or a real data-preservation hazard.
 */

/** A precise identity for one tolerated class-23 skip. `reasonCode` is the
 *  SQLSTATE (`23502` NOT NULL w/o default, `23503` FK, `23505` unique,
 *  `23514` check, …). No bare table names: every field is required so an
 *  unexpected scenario/direction/reason is NOT silently swallowed. */
export interface SeedSkipKey {
  scenario: string;
  direction: "forward" | "reverse";
  table: { schema: string; name: string };
  reasonCode: string;
}

export const AUTOSEED_SKIP_ALLOWLIST: readonly SeedSkipKey[] = [
  // 170 entries — 169 are a NOT NULL-without-default column (SQLSTATE 23502):
  // the empty kept table cannot take INSERT ... DEFAULT VALUES; 1 is "no_row"
  // (a BEFORE INSERT trigger that RETURNS NULL suppresses the row). Sorted by
  // scenario, then direction, then schema.name.
  {
    scenario: "alter-column-type--blocked-by-policy",
    direction: "forward",
    table: { schema: "t", name: "cats" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-column-type--blocked-by-policy",
    direction: "reverse",
    table: { schema: "t", name: "cats" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-column-type--blocked-by-view",
    direction: "forward",
    table: { schema: "t", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-column-type--blocked-by-view",
    direction: "reverse",
    table: { schema: "t", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-column-type--swap-user-types",
    direction: "forward",
    table: { schema: "app", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-column-type--swap-user-types",
    direction: "reverse",
    table: { schema: "app", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--add-column-then-unique",
    direction: "forward",
    table: { schema: "test_schema", name: "idx_users" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--add-column-then-unique",
    direction: "reverse",
    table: { schema: "test_schema", name: "idx_users" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--column-type-cast",
    direction: "reverse",
    table: { schema: "test_schema", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--column-type-cast",
    direction: "reverse",
    table: { schema: "test_schema", name: "priced" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--column-type-enum-default",
    direction: "reverse",
    table: { schema: "test_schema", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--generated-column",
    direction: "forward",
    table: { schema: "test_schema", name: "calculations" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--generated-column",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--generated-column",
    direction: "reverse",
    table: { schema: "test_schema", name: "calculations" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--generated-column",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--multi-alter-ops",
    direction: "forward",
    table: { schema: "test_schema", name: "evolution" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--multi-alter-ops",
    direction: "reverse",
    table: { schema: "test_schema", name: "evolution" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--not-null",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--replica-identity",
    direction: "forward",
    table: { schema: "test_schema", name: "replicated" },
    reasonCode: "23502",
  },
  {
    scenario: "alter-table--replica-identity",
    direction: "reverse",
    table: { schema: "test_schema", name: "replicated" },
    reasonCode: "23502",
  },
  {
    scenario: "catalog-diff--multi-entity-alter",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "catalog-diff--multi-entity-alter",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "column-add",
    direction: "reverse",
    table: { schema: "app", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "column-type-change",
    direction: "reverse",
    table: { schema: "app", name: "events" },
    reasonCode: "23502",
  },
  {
    scenario: "comments",
    direction: "forward",
    table: { schema: "public", name: "docs" },
    reasonCode: "23502",
  },
  {
    scenario: "comments",
    direction: "reverse",
    table: { schema: "public", name: "docs" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--comments",
    direction: "forward",
    table: { schema: "test_schema", name: "events" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--comments",
    direction: "reverse",
    table: { schema: "test_schema", name: "events" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--composite-fk",
    direction: "forward",
    table: { schema: "test_schema", name: "child" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--composite-fk",
    direction: "forward",
    table: { schema: "test_schema", name: "parent" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--composite-fk",
    direction: "reverse",
    table: { schema: "test_schema", name: "child" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--composite-fk",
    direction: "reverse",
    table: { schema: "test_schema", name: "parent" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--deferrable-unique",
    direction: "forward",
    table: { schema: "test_schema", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--deferrable-unique",
    direction: "reverse",
    table: { schema: "test_schema", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--exclude",
    direction: "forward",
    table: { schema: "test_schema", name: "expr_excl" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--exclude",
    direction: "forward",
    table: { schema: "test_schema", name: "reservations" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--exclude",
    direction: "reverse",
    table: { schema: "test_schema", name: "expr_excl" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--exclude",
    direction: "reverse",
    table: { schema: "test_schema", name: "reservations" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--pk-unique-check",
    direction: "forward",
    table: { schema: "test_schema", name: "products" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--pk-unique-check",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--pk-unique-check",
    direction: "reverse",
    table: { schema: "test_schema", name: "products" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--pk-unique-check",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--quoted-names",
    direction: "forward",
    table: { schema: "my-schema", name: "my-table" },
    reasonCode: "23502",
  },
  {
    scenario: "constraint-ops--quoted-names",
    direction: "reverse",
    table: { schema: "my-schema", name: "my-table" },
    reasonCode: "23502",
  },
  {
    scenario: "default-privileges-edge-case--table-revoke-after-default",
    direction: "forward",
    table: { schema: "public", name: "test" },
    reasonCode: "23502",
  },
  {
    scenario: "default-privileges-edge-case--table-revoke-after-default",
    direction: "reverse",
    table: { schema: "public", name: "test" },
    reasonCode: "23502",
  },
  {
    scenario: "defaults",
    direction: "reverse",
    table: { schema: "public", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--alter-seq-datatype-owned-col-survives",
    direction: "forward",
    table: { schema: "public", name: "addons" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--alter-seq-datatype-owned-col-survives",
    direction: "reverse",
    table: { schema: "public", name: "addons" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--drop-publication-fk-chain-tables",
    direction: "forward",
    table: { schema: "public", name: "labs" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--drop-publication-fk-chain-tables",
    direction: "reverse",
    table: { schema: "public", name: "labs" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--drop-publication-listed-column",
    direction: "forward",
    table: { schema: "public", name: "lab_results" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--drop-publication-listed-column",
    direction: "reverse",
    table: { schema: "public", name: "lab_results" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--enum-replace-dependent-table-drops-fk-col",
    direction: "forward",
    table: { schema: "public", name: "children" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--enum-replace-dependent-table-drops-fk-col",
    direction: "forward",
    table: { schema: "public", name: "parents" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--enum-replace-dependent-table-drops-fk-col",
    direction: "reverse",
    table: { schema: "public", name: "children" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--enum-replace-dependent-table-drops-fk-col",
    direction: "reverse",
    table: { schema: "public", name: "parents" },
    reasonCode: "23502",
  },
  {
    scenario:
      "dependencies-cycles--enum-replace-drops-serial-on-promoted-table",
    direction: "reverse",
    table: { schema: "public", name: "project_link_type" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--sequence-owned-by-add-column",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "dependencies-cycles--sequence-owned-by-add-column",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "fk-ordering--on-delete-cascade",
    direction: "forward",
    table: { schema: "test_schema", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "fk-ordering--on-delete-cascade",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "fk-ordering--on-delete-cascade",
    direction: "reverse",
    table: { schema: "test_schema", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "fk-ordering--on-delete-cascade",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "function-ops--begin-atomic-replacement",
    direction: "forward",
    table: { schema: "test_schema", name: "accounts" },
    reasonCode: "23502",
  },
  {
    scenario: "function-ops--begin-atomic-replacement",
    direction: "reverse",
    table: { schema: "test_schema", name: "accounts" },
    reasonCode: "23502",
  },
  {
    scenario: "function-ops--signature-change-referenced-by-check",
    direction: "reverse",
    table: { schema: "probe_constraint", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "function-ops--signature-change-referenced-by-default",
    direction: "reverse",
    table: { schema: "probe_default", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "function-ops--signature-change-referenced-by-policy",
    direction: "forward",
    table: { schema: "t", name: "profiles" },
    reasonCode: "23502",
  },
  {
    scenario: "function-ops--signature-change-referenced-by-policy",
    direction: "reverse",
    table: { schema: "t", name: "profiles" },
    reasonCode: "23502",
  },
  {
    scenario: "index",
    direction: "forward",
    table: { schema: "public", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "index",
    direction: "reverse",
    table: { schema: "public", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--comment",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--comment",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--create",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--create",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--drop",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--drop",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--joins",
    direction: "forward",
    table: { schema: "ecommerce", name: "customers" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--joins",
    direction: "forward",
    table: { schema: "ecommerce", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--joins",
    direction: "reverse",
    table: { schema: "ecommerce", name: "customers" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--joins",
    direction: "reverse",
    table: { schema: "ecommerce", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--replace-definition",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--replace-definition",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--restore-metadata-on-replace",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--restore-metadata-on-replace",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--with-dependent-index-and-view",
    direction: "forward",
    table: { schema: "test_schema", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "materialized-view-operations--with-dependent-index-and-view",
    direction: "reverse",
    table: { schema: "test_schema", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "mixed-objects--cross-schema-reference",
    direction: "forward",
    table: { schema: "app", name: "docs" },
    reasonCode: "23502",
  },
  {
    scenario: "mixed-objects--cross-schema-reference",
    direction: "reverse",
    table: { schema: "app", name: "docs" },
    reasonCode: "23502",
  },
  {
    scenario: "mixed-objects--enum-add-value-with-functions",
    direction: "forward",
    table: { schema: "test_schema", name: "order_history" },
    reasonCode: "23502",
  },
  {
    scenario: "mixed-objects--enum-add-value-with-functions",
    direction: "forward",
    table: { schema: "test_schema", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "mixed-objects--enum-add-value-with-functions",
    direction: "reverse",
    table: { schema: "test_schema", name: "order_history" },
    reasonCode: "23502",
  },
  {
    scenario: "mixed-objects--enum-add-value-with-functions",
    direction: "reverse",
    table: { schema: "test_schema", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "mixed-objects--enum-replace-with-dependents",
    direction: "forward",
    table: { schema: "test_schema", name: "task_history" },
    reasonCode: "23502",
  },
  {
    scenario: "mixed-objects--enum-replace-with-dependents",
    direction: "forward",
    table: { schema: "test_schema", name: "tasks" },
    reasonCode: "23502",
  },
  {
    scenario: "mixed-objects--enum-replace-with-dependents",
    direction: "reverse",
    table: { schema: "test_schema", name: "task_history" },
    reasonCode: "23502",
  },
  {
    scenario: "mixed-objects--enum-replace-with-dependents",
    direction: "reverse",
    table: { schema: "test_schema", name: "tasks" },
    reasonCode: "23502",
  },
  {
    scenario: "not-valid--fk-validate-drift",
    direction: "forward",
    table: { schema: "test_schema", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "not-valid--fk-validate-drift",
    direction: "forward",
    table: { schema: "test_schema", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "not-valid--fk-validate-drift",
    direction: "reverse",
    table: { schema: "test_schema", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "not-valid--fk-validate-drift",
    direction: "reverse",
    table: { schema: "test_schema", name: "orders" },
    reasonCode: "23502",
  },
  {
    scenario: "ordering-validation--table-owner-change",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "ordering-validation--table-owner-change",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--add-partition-to-existing",
    direction: "forward",
    table: { schema: "test_schema", name: "events_2024" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--add-partition-to-existing",
    direction: "reverse",
    table: { schema: "test_schema", name: "events_2024" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--comprehensive-all-features",
    direction: "forward",
    table: { schema: "test_schema", name: "customers" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--comprehensive-all-features",
    direction: "forward",
    table: { schema: "test_schema", name: "orders_2024" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--comprehensive-all-features",
    direction: "forward",
    table: { schema: "test_schema", name: "orders_2025" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--comprehensive-all-features",
    direction: "reverse",
    table: { schema: "test_schema", name: "customers" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--comprehensive-all-features",
    direction: "reverse",
    table: { schema: "test_schema", name: "orders_2024" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--comprehensive-all-features",
    direction: "reverse",
    table: { schema: "test_schema", name: "orders_2025" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--list-partition-with-default",
    direction: "forward",
    table: { schema: "test_schema", name: "documents_default" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--list-partition-with-default",
    direction: "forward",
    table: { schema: "test_schema", name: "documents_paxafe" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--list-partition-with-default",
    direction: "reverse",
    table: { schema: "test_schema", name: "documents_default" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--list-partition-with-default",
    direction: "reverse",
    table: { schema: "test_schema", name: "documents_paxafe" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--parent-unique-with-partition-key",
    direction: "forward",
    table: { schema: "test_schema", name: "products_2024" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--parent-unique-with-partition-key",
    direction: "forward",
    table: { schema: "test_schema", name: "products_2025" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--parent-unique-with-partition-key",
    direction: "reverse",
    table: { schema: "test_schema", name: "products_2024" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--parent-unique-with-partition-key",
    direction: "reverse",
    table: { schema: "test_schema", name: "products_2025" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--range-partition-with-indexes",
    direction: "forward",
    table: { schema: "test_schema", name: "orders_2024" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--range-partition-with-indexes",
    direction: "forward",
    table: { schema: "test_schema", name: "orders_2025" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--range-partition-with-indexes",
    direction: "reverse",
    table: { schema: "test_schema", name: "orders_2024" },
    reasonCode: "23502",
  },
  {
    scenario: "partitioned-table-operations--range-partition-with-indexes",
    direction: "reverse",
    table: { schema: "test_schema", name: "orders_2025" },
    reasonCode: "23502",
  },
  {
    scenario: "policy-dependencies--policy-depending-on-replaced-function",
    direction: "forward",
    table: {
      schema: "public",
      name: "alter_function_sign_policy_dependent_profiles",
    },
    reasonCode: "23502",
  },
  {
    scenario: "policy-dependencies--policy-depending-on-replaced-function",
    direction: "reverse",
    table: {
      schema: "public",
      name: "alter_function_sign_policy_dependent_profiles",
    },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--enable-disable-rls",
    direction: "forward",
    table: { schema: "app", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--enable-disable-rls",
    direction: "reverse",
    table: { schema: "app", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--policies-select-insert-update",
    direction: "forward",
    table: { schema: "forum", name: "messages" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--policies-select-insert-update",
    direction: "reverse",
    table: { schema: "forum", name: "messages" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--policy-comment",
    direction: "forward",
    table: { schema: "app", name: "docs" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--policy-comment",
    direction: "reverse",
    table: { schema: "app", name: "docs" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--policy-roles-swap",
    direction: "forward",
    table: { schema: "public", name: "docs" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--policy-roles-swap",
    direction: "reverse",
    table: { schema: "public", name: "docs" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--replace-function-referenced-by-policy",
    direction: "forward",
    table: { schema: "app", name: "docs" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--replace-function-referenced-by-policy",
    direction: "reverse",
    table: { schema: "app", name: "docs" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--restrictive-policy",
    direction: "forward",
    table: { schema: "secure", name: "sensitive_data" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-operations--restrictive-policy",
    direction: "reverse",
    table: { schema: "secure", name: "sensitive_data" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-policy",
    direction: "forward",
    table: { schema: "public", name: "notes" },
    reasonCode: "23502",
  },
  {
    scenario: "rls-policy",
    direction: "reverse",
    table: { schema: "public", name: "notes" },
    reasonCode: "23502",
  },
  {
    scenario: "rule-operations--replace-rule-do-also-insert",
    direction: "forward",
    table: { schema: "test_schema", name: "rule_events" },
    reasonCode: "23502",
  },
  {
    scenario: "rule-operations--replace-rule-do-also-insert",
    direction: "reverse",
    table: { schema: "test_schema", name: "rule_events" },
    reasonCode: "23502",
  },
  {
    scenario: "sequence-operations--drop-sequence-referenced-by-default",
    direction: "reverse",
    table: { schema: "test_schema", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "sequence-operations--serial-and-identity-transition",
    direction: "forward",
    table: { schema: "test_schema", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "table-ops--comments",
    direction: "forward",
    table: { schema: "test_schema", name: "events" },
    reasonCode: "23502",
  },
  {
    scenario: "table-ops--comments",
    direction: "reverse",
    table: { schema: "test_schema", name: "events" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger",
    direction: "forward",
    table: { schema: "public", name: "audit_me" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger",
    direction: "reverse",
    table: { schema: "public", name: "audit_me" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--constraint-trigger-create",
    direction: "forward",
    table: { schema: "test_schema", name: "accounts" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--constraint-trigger-create",
    direction: "reverse",
    table: { schema: "test_schema", name: "accounts" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--constraint-trigger-deferrability-change",
    direction: "forward",
    table: { schema: "test_schema", name: "roles" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--constraint-trigger-deferrability-change",
    direction: "reverse",
    table: { schema: "test_schema", name: "roles" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--instead-of-trigger-on-view",
    direction: "forward",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--instead-of-trigger-on-view",
    direction: "reverse",
    table: { schema: "test_schema", name: "users" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--shared-function-multi-trigger-drop",
    direction: "forward",
    table: { schema: "test_schema", name: "bar" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--shared-function-multi-trigger-drop",
    direction: "forward",
    table: { schema: "test_schema", name: "foo" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--shared-function-multi-trigger-drop",
    direction: "reverse",
    table: { schema: "test_schema", name: "bar" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--shared-function-multi-trigger-drop",
    direction: "reverse",
    table: { schema: "test_schema", name: "foo" },
    reasonCode: "23502",
  },
  {
    // forward: an all-nullable table whose BEFORE INSERT trigger RETURNS NULL,
    // so INSERT ... DEFAULT VALUES succeeds with zero rows (nothing seeded).
    scenario: "trigger-operations--trigger-drop-before-function-drop",
    direction: "forward",
    table: { schema: "test_schema", name: "foo" },
    reasonCode: "no_row",
  },
  {
    scenario: "trigger-operations--trigger-drop-before-function-drop",
    direction: "reverse",
    table: { schema: "test_schema", name: "foo" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--trigger-update-of-columns",
    direction: "forward",
    table: { schema: "test_schema", name: "user_account" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--trigger-update-of-columns",
    direction: "reverse",
    table: { schema: "test_schema", name: "user_account" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--trigger-with-when-clause",
    direction: "forward",
    table: { schema: "test_schema", name: "products" },
    reasonCode: "23502",
  },
  {
    scenario: "trigger-operations--trigger-with-when-clause",
    direction: "reverse",
    table: { schema: "test_schema", name: "products" },
    reasonCode: "23502",
  },
  {
    scenario: "type-ops--composite-alter-attributes",
    direction: "reverse",
    table: { schema: "test_schema", name: "locations" },
    reasonCode: "23502",
  },
  {
    scenario: "type-ops--enum-add-value-used-in-new-column",
    direction: "forward",
    table: { schema: "public", name: "feelings" },
    reasonCode: "23502",
  },
  {
    scenario: "type-ops--enum-add-value-used-in-new-column",
    direction: "reverse",
    table: { schema: "public", name: "feelings" },
    reasonCode: "23502",
  },
  {
    scenario: "type-ops--enum-replace-array-column",
    direction: "reverse",
    table: { schema: "test_schema", name: "tasks" },
    reasonCode: "23502",
  },
  {
    scenario: "view-operations--recreate-select-star",
    direction: "forward",
    table: { schema: "test_schema", name: "items" },
    reasonCode: "23502",
  },
  {
    scenario: "view-operations--recreate-select-star",
    direction: "reverse",
    table: { schema: "test_schema", name: "items" },
    reasonCode: "23502",
  },
];

const keyOf = (k: SeedSkipKey): string =>
  JSON.stringify([
    k.scenario,
    k.direction,
    k.table.schema,
    k.table.name,
    k.reasonCode,
  ]);

const ALLOWED: ReadonlySet<string> = new Set(
  AUTOSEED_SKIP_ALLOWLIST.map(keyOf),
);

/** True when this exact class-23 skip is a declared, expected non-seed. Strict:
 *  an unknown scenario/direction/table/reasonCode combination is NOT allowed. */
export function isSeedSkipAllowed(
  scenario: string,
  direction: "forward" | "reverse",
  table: { schema: string; name: string },
  reasonCode: string,
): boolean {
  return ALLOWED.has(keyOf({ scenario, direction, table, reasonCode }));
}
