import type { Sql } from "postgres";
import { BasePgModel } from "../base.model.ts";

export interface DomainProps {
  schema: string;
  name: string;
  base_type: string;
  base_type_schema: string;
  base_type_str?: string;
  not_null: boolean;
  type_modifier: number | null;
  array_dimensions: number | null;
  collation: string | null;
  default_bin: string | null;
  default_value: string | null;
  owner: string;
  constraints: DomainConstraintProps[];
}

export interface DomainConstraintProps {
  name: string;
  validated: boolean;
  is_local: boolean;
  no_inherit: boolean;
  check_expression: string | null;
  owner: string;
}

/**
 * A domain is a user-defined data type that is based on another underlying type.
 *
 * @see https://www.postgresql.org/docs/17/domains.html#DOMAINS
 */
export class Domain extends BasePgModel {
  public readonly schema: DomainProps["schema"];
  public readonly name: DomainProps["name"];
  public readonly base_type: DomainProps["base_type"];
  public readonly base_type_schema: DomainProps["base_type_schema"];
  public readonly base_type_str?: DomainProps["base_type_str"];
  public readonly not_null: DomainProps["not_null"];
  public readonly type_modifier: DomainProps["type_modifier"];
  public readonly array_dimensions: DomainProps["array_dimensions"];
  public readonly collation: DomainProps["collation"];
  public readonly default_bin: DomainProps["default_bin"];
  public readonly default_value: DomainProps["default_value"];
  public readonly owner: DomainProps["owner"];
  public readonly constraints: DomainConstraintProps[];

  constructor(props: DomainProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.base_type = props.base_type;
    this.base_type_schema = props.base_type_schema;
    this.base_type_str = props.base_type_str;
    this.not_null = props.not_null;
    this.type_modifier = props.type_modifier;
    this.array_dimensions = props.array_dimensions;
    this.collation = props.collation;
    this.default_bin = props.default_bin;
    this.default_value = props.default_value;
    this.owner = props.owner;
    this.constraints = props.constraints;
  }

  get stableId(): `domain:${string}` {
    return `domain:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      base_type: this.base_type,
      base_type_schema: this.base_type_schema,
      not_null: this.not_null,
      type_modifier: this.type_modifier,
      array_dimensions: this.array_dimensions,
      collation: this.collation,
      default_bin: this.default_bin,
      default_value: this.default_value,
      owner: this.owner,
      constraints: this.constraints,
    };
  }
}

/**
 * Extract all domains from the database.
 *
 * @param sql - The SQL client.
 * @returns A list of domains.
 */
export async function extractDomains(sql: Sql): Promise<Domain[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const domainRows = await sql<DomainProps[]>`
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
        bt.typname as base_type,
        bn.nspname as base_type_schema,
        format_type(t.typbasetype, t.typtypmod) as base_type_str,
        t.typnotnull as not_null,
        t.typtypmod as type_modifier,
        t.typndims as array_dimensions,
        case when t.typcollation <> bt.typcollation then c.collname else null end as collation,
        pg_get_expr(t.typdefaultbin, 0) as default_bin,
        t.typdefault as default_value,
        pg_get_userbyid(t.typowner) as owner,
        coalesce(
          (
            select json_agg(
              json_build_object(
                'name', con.conname,
                'validated', con.convalidated,
                'is_local', con.conislocal,
                'no_inherit', con.connoinherit,
                'check_expression', pg_get_expr(con.conbin, 0)
              )
              order by con.conname
            )
            from pg_catalog.pg_constraint con
            where con.contypid = t.oid
          ), '[]'
        ) as constraints
      from
        pg_catalog.pg_type t
        inner join pg_catalog.pg_namespace n on n.oid = t.typnamespace
        inner join pg_catalog.pg_type bt on bt.oid = t.typbasetype
        inner join pg_catalog.pg_namespace bn on bn.oid = bt.typnamespace
        left join pg_catalog.pg_collation c on c.oid = t.typcollation
        left outer join extension_oids e on t.oid = e.objid
        where not t.typnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
        and e.objid is null
        and t.typtype = 'd'
      order by
        1, 2;
    `;
    return domainRows.map((row) => new Domain(row));
  });
}
