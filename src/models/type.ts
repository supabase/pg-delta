import type { Sql } from "postgres";
import { BasePgModel } from "./base.ts";

export type TypeKind = "b" | "c" | "d" | "e" | "p";
export type TypeCategory =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "G"
  | "I"
  | "N"
  | "P"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "X";
type TypeAlignment = "c" | "s" | "i" | "d";
type TypeStorage = "p" | "e" | "m" | "x";

interface TypeProps {
  schema: string;
  name: string;
  type_type: TypeKind;
  type_category: TypeCategory;
  is_preferred: boolean;
  is_defined: boolean;
  delimiter: string;
  storage_length: number;
  passed_by_value: boolean;
  alignment: TypeAlignment;
  storage: TypeStorage;
  not_null: boolean;
  type_modifier: number | null;
  array_dimensions: number | null;
  default_bin: string | null;
  default_value: string | null;
  owner: string;
}

export class Type extends BasePgModel {
  public readonly schema: TypeProps["schema"];
  public readonly name: TypeProps["name"];
  public readonly type_type: TypeProps["type_type"];
  public readonly type_category: TypeProps["type_category"];
  public readonly is_preferred: TypeProps["is_preferred"];
  public readonly is_defined: TypeProps["is_defined"];
  public readonly delimiter: TypeProps["delimiter"];
  public readonly storage_length: TypeProps["storage_length"];
  public readonly passed_by_value: TypeProps["passed_by_value"];
  public readonly alignment: TypeProps["alignment"];
  public readonly storage: TypeProps["storage"];
  public readonly not_null: TypeProps["not_null"];
  public readonly type_modifier: TypeProps["type_modifier"];
  public readonly array_dimensions: TypeProps["array_dimensions"];
  public readonly default_bin: TypeProps["default_bin"];
  public readonly default_value: TypeProps["default_value"];
  public readonly owner: TypeProps["owner"];

  constructor(props: TypeProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.type_type = props.type_type;
    this.type_category = props.type_category;
    this.is_preferred = props.is_preferred;
    this.is_defined = props.is_defined;
    this.delimiter = props.delimiter;
    this.storage_length = props.storage_length;
    this.passed_by_value = props.passed_by_value;
    this.alignment = props.alignment;
    this.storage = props.storage;
    this.not_null = props.not_null;
    this.type_modifier = props.type_modifier;
    this.array_dimensions = props.array_dimensions;
    this.default_bin = props.default_bin;
    this.default_value = props.default_value;
    this.owner = props.owner;
  }

  get stableId(): `type:${string}` {
    return `type:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      type_type: this.type_type,
      type_category: this.type_category,
      is_preferred: this.is_preferred,
      is_defined: this.is_defined,
      delimiter: this.delimiter,
      storage_length: this.storage_length,
      passed_by_value: this.passed_by_value,
      alignment: this.alignment,
      storage: this.storage,
      not_null: this.not_null,
      type_modifier: this.type_modifier,
      array_dimensions: this.array_dimensions,
      default_bin: this.default_bin,
      default_value: this.default_value,
      owner: this.owner,
    };
  }
}

export async function extractTypes(sql: Sql): Promise<Type[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const typeRows = await sql<TypeProps[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_type'::regclass
)
select
  n.nspname as schema,
  t.typname as name,
  t.typtype as type_type,
  t.typcategory as type_category,
  t.typispreferred as is_preferred,
  t.typisdefined as is_defined,
  t.typdelim as delimiter,
  t.typlen as storage_length,
  t.typbyval as passed_by_value,
  t.typalign as alignment,
  t.typstorage as storage,
  t.typnotnull as not_null,
  t.typtypmod as type_modifier,
  t.typndims as array_dimensions,
  pg_get_expr(t.typdefaultbin, 0) as default_bin,
  t.typdefault as default_value,
  pg_get_userbyid(t.typowner) as owner
from
  pg_catalog.pg_type t
  inner join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  left outer join extension_oids e on t.oid = e.objid
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
order by
  1, 2;
    `;
    return typeRows.map((row) => new Type(row));
  });
}
