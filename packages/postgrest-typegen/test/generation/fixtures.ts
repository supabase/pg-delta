/**
 * Fixture builders for generation unit tests, ported from the pattern in
 * `postgres-meta/test/server/templates/go.test.ts` and generalized so the Go
 * and Python (and later TypeScript/Swift) generators can share one set of
 * inputs.
 *
 * These produce the `GeneratorMetadata` contract directly — no database — so
 * generation can be exercised as a pure function with inline snapshots.
 */
import type {
  GeneratorMetadata,
  PostgresColumn,
  PostgresMaterializedView,
  PostgresSchema,
  PostgresTable,
  PostgresType,
  PostgresView,
} from "../../src/types.ts";

const baseSchema: PostgresSchema = {
  id: 1,
  name: "public",
  owner: "postgres",
};

export const baseTable = (
  overrides: Partial<Omit<PostgresTable, "columns">> = {},
): Omit<PostgresTable, "columns"> =>
  ({
    id: 1,
    schema: "public",
    name: "tickets",
    rls_enabled: false,
    rls_forced: false,
    replica_identity: "DEFAULT",
    bytes: 0,
    size: "0 bytes",
    live_rows_estimate: 0,
    dead_rows_estimate: 0,
    comment: null,
    primary_keys: [],
    relationships: [],
    ...overrides,
  }) as unknown as Omit<PostgresTable, "columns">;

export const baseView = (
  overrides: Partial<Omit<PostgresView, "columns">> = {},
): Omit<PostgresView, "columns"> => ({
  id: 1,
  schema: "public",
  name: "tickets_view",
  is_updatable: false,
  comment: null,
  ...overrides,
});

export const baseMaterializedView = (
  overrides: Partial<Omit<PostgresMaterializedView, "columns">> = {},
): Omit<PostgresMaterializedView, "columns"> => ({
  id: 1,
  schema: "public",
  name: "tickets_matview",
  is_populated: true,
  comment: null,
  ...overrides,
});

export const userStatusEnum: PostgresType = {
  id: 100,
  name: "user_status",
  schema: "public",
  format: "user_status",
  enums: ["ACTIVE", "INACTIVE"],
  attributes: [],
  comment: null,
  type_relation_id: null,
};

/**
 * A composite type `address` with two text attributes. `type_id` 25 is the
 * Postgres OID for `text`, matched by the builtin text fixture below so the
 * generators can resolve attribute types.
 */
export const addressCompositeType: PostgresType = {
  id: 200,
  name: "address",
  schema: "public",
  format: "address",
  enums: [],
  attributes: [
    { name: "street", type_id: 25 },
    { name: "city", type_id: 25 },
  ],
  comment: null,
  type_relation_id: 200,
};

/** Minimal builtin `text` type so composite attribute lookups resolve. */
export const textType: PostgresType = {
  id: 25,
  name: "text",
  schema: "pg_catalog",
  format: "text",
  enums: [],
  attributes: [],
  comment: null,
  type_relation_id: null,
};

export const baseColumn = (
  overrides: Partial<PostgresColumn>,
): PostgresColumn =>
  ({
    table_id: 1,
    schema: "public",
    table: "tickets",
    id: "1.1",
    ordinal_position: 1,
    name: "col",
    default_value: null,
    data_type: "text",
    format: "text",
    is_identity: false,
    identity_generation: null,
    is_generated: false,
    is_nullable: false,
    is_updatable: true,
    is_unique: false,
    enums: [],
    check: null,
    comment: null,
    ...overrides,
  }) as PostgresColumn;

/**
 * Build a complete `GeneratorMetadata` from partial pieces. Defaults to a
 * single `public` schema with the `user_status` enum and `text` builtin
 * registered so most fixtures resolve without extra wiring.
 */
export const buildMetadata = (
  overrides: Partial<GeneratorMetadata> = {},
): GeneratorMetadata => ({
  schemas: [baseSchema],
  tables: [],
  foreignTables: [],
  views: [],
  materializedViews: [],
  columns: [],
  relationships: [],
  functions: [],
  types: [userStatusEnum, textType],
  ...overrides,
});
