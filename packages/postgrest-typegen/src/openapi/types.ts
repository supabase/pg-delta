/**
 * Contract for the `x-postgrest-typegen-metadata` OpenAPI vendor extension.
 *
 * This is the cross-repo contract between PostgREST (which emits the block under
 * the opt-in `openapi-metadata` config) and this package's OpenAPI producer
 * ({@link openApiToGeneratorMetadata}). It is intentionally name-keyed (no OIDs)
 * and shaped to mirror {@link GeneratorMetadata} so the adapter is a thin map.
 *
 * Field conventions are chosen to match what `introspect()` emits, so the
 * adapter can pass values through and produce byte-identical generator output:
 * - `column.format` is the pg_catalog short type name (`pg_type.typname`):
 *   `int8`, `_text` (arrays prefixed `_`), `user_status` (enum/composite names).
 * - `relationship.is_one_to_one` is `true` exactly when PostgREST's cardinality
 *   is `O2O` (or a single-row computed relationship).
 * - `function.argument_types` is the comma-joined argument *type* names, with
 *   table-row args spelled as the bare table name (so the generator can attach a
 *   single-table-arg function to that table's Row as a computed field).
 */

export type MetadataRelationKind =
  | "table"
  | "view"
  | "materialized_view"
  | "foreign_table";

export interface MetadataColumn {
  name: string;
  /** pg_catalog short type name (`pg_type.typname`); arrays prefixed `_`. */
  format: string;
  /** SQL spelling (`format_type`). Cosmetic for TS generation; defaults to `format`. */
  data_type?: string;
  is_nullable: boolean;
  /** Raw default expression, or null. */
  default_value?: string | null;
  is_identity: boolean;
  identity_generation?: "ALWAYS" | "BY DEFAULT" | null;
  is_generated: boolean;
  /** Per-column updatability — required to render view Insert/Update correctly. */
  is_updatable: boolean;
  is_unique?: boolean;
  /** Enum variants when the column's type is an enum (else empty/omitted). */
  enums?: string[];
  check?: string | null;
  comment?: string | null;
}

export interface MetadataTable {
  schema: string;
  name: string;
  kind: MetadataRelationKind;
  /** Relation-level updatability; drives view Insert/Update generation. */
  updatable: boolean;
  /** Materialized-view population state; only meaningful for `materialized_view`. */
  is_populated?: boolean;
  comment?: string | null;
  columns: MetadataColumn[];
}

export interface MetadataRelationship {
  /** FK constraint name (or computed-relationship function name). */
  constraint_name: string;
  schema: string;
  relation: string;
  columns: string[];
  is_one_to_one: boolean;
  referenced_schema: string;
  referenced_relation: string;
  referenced_columns: string[];
}

export interface MetadataFunctionArg {
  name: string;
  /** pg_catalog short type name, same convention as column.format. */
  type: string;
  mode: "in" | "out" | "inout" | "variadic" | "table";
  has_default: boolean;
}

export interface MetadataFunctionReturn {
  /** pg_catalog short type name of the return (scalar/composite), or the relation name. */
  type: string;
  is_set: boolean;
  /** When the function returns a table/view row type, its schema+name; else null. */
  relation?: { schema: string; name: string } | null;
  /** `prorows` estimate when set-returning; null otherwise. */
  rows?: number | null;
}

export interface MetadataFunction {
  schema: string;
  name: string;
  /** Comma-joined argument type names; bare table name for a single table-row arg. */
  argument_types: string;
  args: MetadataFunctionArg[];
  return: MetadataFunctionReturn;
  volatility: "IMMUTABLE" | "STABLE" | "VOLATILE";
  language?: string;
}

export interface MetadataComposite {
  schema: string;
  name: string;
  attributes: { name: string; type: string }[];
}

export interface MetadataEnum {
  schema: string;
  name: string;
  values: string[];
}

export interface MetadataSchema {
  name: string;
  owner?: string;
}

export interface PostgrestTypegenMetadata {
  schemas: MetadataSchema[];
  tables: MetadataTable[];
  relationships: MetadataRelationship[];
  functions: MetadataFunction[];
  composites: MetadataComposite[];
  enums: MetadataEnum[];
}

/** The OpenAPI (Swagger 2.0) document, narrowed to the bit we consume. */
export interface OpenApiDocumentWithMetadata {
  "x-postgrest-typegen-metadata"?: PostgrestTypegenMetadata;
  [key: string]: unknown;
}

/** The vendor-extension key carrying the metadata block. */
export const METADATA_EXTENSION_KEY = "x-postgrest-typegen-metadata" as const;
