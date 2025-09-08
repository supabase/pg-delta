import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const domainConstraintPropsSchema = z.object({
  name: z.string(),
  validated: z.boolean(),
  is_local: z.boolean(),
  no_inherit: z.boolean(),
  check_expression: z.string().nullable(),
});

const domainPropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  base_type: z.string(),
  base_type_schema: z.string(),
  base_type_str: z.string().optional(),
  not_null: z.boolean(),
  type_modifier: z.number().nullable(),
  array_dimensions: z.number().nullable(),
  collation: z.string().nullable(),
  default_bin: z.string().nullable(),
  default_value: z.string().nullable(),
  owner: z.string(),
  constraints: z.array(domainConstraintPropsSchema),
});

export type DomainConstraintProps = z.infer<typeof domainConstraintPropsSchema>;
export type DomainProps = z.infer<typeof domainPropsSchema>;

/**
 * A domain is a user-defined data type that is based on another underlying type.
 *
 * @see https://www.postgresql.org/docs/17/domains.html
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
    const domainRows = await sql`
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
        t.typnamespace::regnamespace::text as schema,
        quote_ident(t.typname) as name,
        bt.typname as base_type,
        bt.typnamespace::regnamespace::text as base_type_schema,
        format_type(t.typbasetype, t.typtypmod) as base_type_str,
        t.typnotnull as not_null,
        t.typtypmod as type_modifier,
        t.typndims as array_dimensions,
        case when t.typcollation <> bt.typcollation then quote_ident(c.collname) else null end as collation,
        pg_get_expr(t.typdefaultbin, 0) as default_bin,
        t.typdefault as default_value,
        t.typowner::regrole::text as owner,
        coalesce(
          (
            select json_agg(
              json_build_object(
                'name', quote_ident(con.conname),
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
        inner join pg_catalog.pg_type bt on bt.oid = t.typbasetype
        left join pg_catalog.pg_collation c on c.oid = t.typcollation
        left outer join extension_oids e on t.oid = e.objid
        where not t.typnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
        and e.objid is null
        and t.typtype = 'd'
      order by
        1, 2;
    `;
    // Validate and parse each row using the Zod schema
    const validatedRows = domainRows.map((row: unknown) =>
      domainPropsSchema.parse(row),
    );
    return validatedRows.map((row: DomainProps) => new Domain(row));
  });
}
