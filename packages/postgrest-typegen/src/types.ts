/**
 * Public metadata contract for type generation.
 *
 * These interfaces are ported from postgres-meta's `src/lib/types.ts`
 * (originally typebox schemas) into plain TypeScript interfaces. The names and
 * shapes are kept identical to upstream so that postgres-meta can consume this
 * package as a drop-in replacement for its embedded templates.
 *
 * `GeneratorMetadata` is the pluggable contract: the SQL introspector is the
 * default producer, but any source able to produce this shape can feed the
 * language generators.
 */

export interface PostgresColumn {
  table_id: number;
  schema: string;
  table: string;
  /** `<table_id>.<ordinal_position>` */
  id: string;
  ordinal_position: number;
  name: string;
  default_value: unknown;
  data_type: string;
  format: string;
  is_identity: boolean;
  identity_generation: "ALWAYS" | "BY DEFAULT" | null;
  is_generated: boolean;
  is_nullable: boolean;
  is_updatable: boolean;
  is_unique: boolean;
  enums: string[];
  check: string | null;
  comment: string | null;
}

export interface PostgresForeignTable {
  id: number;
  schema: string;
  name: string;
  comment: string | null;
  columns?: PostgresColumn[];
}

export interface PostgresFunction {
  id: number;
  schema: string;
  name: string;
  language: string;
  definition: string;
  complete_statement: string;
  args: {
    mode: "in" | "out" | "inout" | "variadic" | "table";
    name: string;
    type_id: number;
    has_default: boolean;
  }[];
  argument_types: string;
  identity_argument_types: string;
  return_type_id: number;
  return_type: string;
  return_type_relation_id: number | null;
  is_set_returning_function: boolean;
  prorows: number | null;
  behavior: "IMMUTABLE" | "STABLE" | "VOLATILE";
  security_definer: boolean;
  config_params: Record<string, string> | null;
}

export interface PostgresMaterializedView {
  id: number;
  schema: string;
  name: string;
  is_populated: boolean;
  comment: string | null;
  columns?: PostgresColumn[];
}

export interface PostgresPrimaryKey {
  schema: string;
  table_name: string;
  name: string;
  table_id: number;
}

/**
 * The legacy/"old" relationship shape carried on `PostgresTable.relationships`.
 * Distinct from the `PostgresRelationship` produced for type generation.
 */
export interface PostgresRelationshipOld {
  id: number;
  constraint_name: string;
  source_schema: string;
  source_table_name: string;
  source_column_name: string;
  target_table_schema: string;
  target_table_name: string;
  target_column_name: string;
}

export interface PostgresRelationship {
  foreign_key_name: string;
  schema: string;
  relation: string;
  columns: string[];
  is_one_to_one: boolean;
  referenced_schema: string;
  referenced_relation: string;
  referenced_columns: string[];
}

export interface PostgresSchema {
  id: number;
  name: string;
  owner: string;
}

export interface PostgresTable {
  id: number;
  schema: string;
  name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  replica_identity: "DEFAULT" | "INDEX" | "FULL" | "NOTHING";
  bytes: number;
  size: string;
  live_rows_estimate: number;
  dead_rows_estimate: number;
  comment: string | null;
  columns?: PostgresColumn[];
  primary_keys: PostgresPrimaryKey[];
  relationships: PostgresRelationshipOld[];
}

export interface PostgresType {
  id: number;
  name: string;
  schema: string;
  format: string;
  enums: string[];
  attributes: { name: string; type_id: number }[];
  comment: string | null;
  type_relation_id: number | null;
}

export interface PostgresView {
  id: number;
  schema: string;
  name: string;
  is_updatable: boolean;
  comment: string | null;
  columns?: PostgresColumn[];
}

/**
 * The complete set of introspected metadata required to generate types.
 * Produced by `introspect()` (the default SQL-based producer) or any other
 * source able to satisfy this shape.
 */
export interface GeneratorMetadata {
  schemas: PostgresSchema[];
  tables: Omit<PostgresTable, "columns">[];
  foreignTables: Omit<PostgresForeignTable, "columns">[];
  views: Omit<PostgresView, "columns">[];
  materializedViews: Omit<PostgresMaterializedView, "columns">[];
  columns: PostgresColumn[];
  relationships: PostgresRelationship[];
  functions: PostgresFunction[];
  types: PostgresType[];
}
