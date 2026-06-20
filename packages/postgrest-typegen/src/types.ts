/**
 * Public metadata contract for type generation.
 *
 * ArkType is the single source of truth: each `Postgres*` schema below is a
 * runtime validator, and the corresponding exported type is derived from it via
 * `.infer`. The shapes are kept identical to postgres-meta's `src/lib/types.ts`
 * so that postgres-meta can consume this package as a drop-in replacement for
 * its embedded templates (a compile-time equivalence test pins this).
 *
 * `GeneratorMetadata` is the pluggable contract: the SQL introspector is the
 * default producer, but any source able to produce this shape can feed the
 * language generators. Because the producer may be an injected adapter,
 * `parseGeneratorMetadata` is offered so integrators can validate a result at
 * runtime instead of blindly casting it. Validation is deliberately *not* baked
 * into `introspect()` — it is an opt-in helper.
 */
import { type } from "arktype";

const postgresColumnSchema = type({
  table_id: "number",
  schema: "string",
  table: "string",
  /** `<table_id>.<ordinal_position>` */
  id: "string",
  ordinal_position: "number",
  name: "string",
  default_value: "unknown",
  data_type: "string",
  format: "string",
  is_identity: "boolean",
  identity_generation: "'ALWAYS' | 'BY DEFAULT' | null",
  is_generated: "boolean",
  is_nullable: "boolean",
  is_updatable: "boolean",
  is_unique: "boolean",
  enums: "string[]",
  check: "string | null",
  comment: "string | null",
});
export type PostgresColumn = typeof postgresColumnSchema.infer;

const postgresForeignTableSchema = type({
  id: "number",
  schema: "string",
  name: "string",
  comment: "string | null",
  "columns?": postgresColumnSchema.array(),
});
export type PostgresForeignTable = typeof postgresForeignTableSchema.infer;

const postgresFunctionSchema = type({
  id: "number",
  schema: "string",
  name: "string",
  language: "string",
  definition: "string",
  complete_statement: "string",
  args: type({
    mode: "'in' | 'out' | 'inout' | 'variadic' | 'table'",
    name: "string",
    type_id: "number",
    // `introspect()` emits `null` for the OUT columns of RETURNS TABLE /
    // OUT-arg functions: the introspection SQL sizes `arg_has_defaults` from
    // the input-arg count while `arg_modes`/`arg_types` include output args,
    // so the trailing rows are padded with NULL. postgres-meta types this as a
    // plain boolean, but the opt-in validator must accept the real output.
    has_default: "boolean | null",
  }).array(),
  argument_types: "string",
  identity_argument_types: "string",
  return_type_id: "number",
  return_type: "string",
  return_type_relation_id: "number | null",
  is_set_returning_function: "boolean",
  prorows: "number | null",
  behavior: "'IMMUTABLE' | 'STABLE' | 'VOLATILE'",
  security_definer: "boolean",
  config_params: type({ "[string]": "string" }).or("null"),
});
export type PostgresFunction = typeof postgresFunctionSchema.infer;

const postgresMaterializedViewSchema = type({
  id: "number",
  schema: "string",
  name: "string",
  is_populated: "boolean",
  comment: "string | null",
  "columns?": postgresColumnSchema.array(),
});
export type PostgresMaterializedView =
  typeof postgresMaterializedViewSchema.infer;

const postgresRelationshipSchema = type({
  foreign_key_name: "string",
  schema: "string",
  relation: "string",
  columns: "string[]",
  is_one_to_one: "boolean",
  referenced_schema: "string",
  referenced_relation: "string",
  referenced_columns: "string[]",
});
export type PostgresRelationship = typeof postgresRelationshipSchema.infer;

const postgresSchemaSchema = type({
  id: "number",
  name: "string",
  owner: "string",
});
export type PostgresSchema = typeof postgresSchemaSchema.infer;

const postgresTableSchema = type({
  id: "number",
  schema: "string",
  name: "string",
  rls_enabled: "boolean",
  rls_forced: "boolean",
  replica_identity: "'DEFAULT' | 'INDEX' | 'FULL' | 'NOTHING'",
  bytes: "number",
  size: "string",
  live_rows_estimate: "number",
  dead_rows_estimate: "number",
  comment: "string | null",
  "columns?": postgresColumnSchema.array(),
});
export type PostgresTable = typeof postgresTableSchema.infer;

const postgresTypeSchema = type({
  id: "number",
  name: "string",
  schema: "string",
  format: "string",
  enums: "string[]",
  attributes: type({ name: "string", type_id: "number" }).array(),
  comment: "string | null",
  type_relation_id: "number | null",
});
export type PostgresType = typeof postgresTypeSchema.infer;

const postgresViewSchema = type({
  id: "number",
  schema: "string",
  name: "string",
  is_updatable: "boolean",
  comment: "string | null",
  "columns?": postgresColumnSchema.array(),
});
export type PostgresView = typeof postgresViewSchema.infer;

/**
 * The complete set of introspected metadata required to generate types.
 * Produced by `introspect()` (the default SQL-based producer) or any other
 * source able to satisfy this shape. The table-like collections drop the
 * optional `columns` field (mirroring `Omit<…, "columns">`); columns are
 * carried separately on `columns`.
 */
export const generatorMetadataSchema = type({
  schemas: postgresSchemaSchema.array(),
  tables: postgresTableSchema.omit("columns").array(),
  foreignTables: postgresForeignTableSchema.omit("columns").array(),
  views: postgresViewSchema.omit("columns").array(),
  materializedViews: postgresMaterializedViewSchema.omit("columns").array(),
  columns: postgresColumnSchema.array(),
  relationships: postgresRelationshipSchema.array(),
  functions: postgresFunctionSchema.array(),
  types: postgresTypeSchema.array(),
});
export type GeneratorMetadata = typeof generatorMetadataSchema.infer;

/**
 * Validate an unknown value against the {@link generatorMetadataSchema} and
 * return it typed as {@link GeneratorMetadata}. Throws a `TypeError` with
 * ArkType's human-readable summary if validation fails.
 *
 * Offered as an opt-in helper so any integrator producing `GeneratorMetadata`
 * through an injected adapter can verify the result at runtime instead of
 * casting. `introspect()` does not call this — wrap its result yourself when
 * you want the guarantee:
 *
 * ```ts
 * const metadata = parseGeneratorMetadata(await introspect(db));
 * ```
 */
export function parseGeneratorMetadata(data: unknown): GeneratorMetadata {
  const out = generatorMetadataSchema(data);
  if (out instanceof type.errors) {
    throw new TypeError(`Invalid GeneratorMetadata: ${out.summary}`);
  }
  return out;
}
