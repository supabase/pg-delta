import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const RlsPolicyCommandSchema = z.enum([
  "r", // SELECT command
  "a", // INSERT command (add)
  "w", // UPDATE command (write)
  "d", // DELETE command
  "*", // ALL commands
]);

const rlsPolicyPropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  table_name: z.string(),
  command: RlsPolicyCommandSchema,
  permissive: z.boolean(),
  roles: z.array(z.string()),
  using_expression: z.string().nullable(),
  with_check_expression: z.string().nullable(),
  owner: z.string(),
  comment: z.string().nullable(),
});

export type RlsPolicyProps = z.infer<typeof rlsPolicyPropsSchema>;

export class RlsPolicy extends BasePgModel {
  public readonly schema: RlsPolicyProps["schema"];
  public readonly name: RlsPolicyProps["name"];
  public readonly table_name: RlsPolicyProps["table_name"];
  public readonly command: RlsPolicyProps["command"];
  public readonly permissive: RlsPolicyProps["permissive"];
  public readonly roles: RlsPolicyProps["roles"];
  public readonly using_expression: RlsPolicyProps["using_expression"];
  public readonly with_check_expression: RlsPolicyProps["with_check_expression"];
  public readonly owner: RlsPolicyProps["owner"];
  public readonly comment: RlsPolicyProps["comment"];

  constructor(props: RlsPolicyProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;
    this.table_name = props.table_name;

    // Data fields
    this.command = props.command;
    this.permissive = props.permissive;
    this.roles = props.roles;
    this.using_expression = props.using_expression;
    this.with_check_expression = props.with_check_expression;
    this.owner = props.owner;
    this.comment = props.comment;
  }

  get stableId(): `rlsPolicy:${string}` {
    return `rlsPolicy:${this.schema}.${this.table_name}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      table_name: this.table_name,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      command: this.command,
      permissive: this.permissive,
      roles: this.roles,
      using_expression: this.using_expression,
      with_check_expression: this.with_check_expression,
      owner: this.owner,
      comment: this.comment,
    };
  }
}

export async function extractRlsPolicies(sql: Sql): Promise<RlsPolicy[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const policyRows = await sql`
with extension_policy_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_policy'::regclass
),
extension_table_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
    and d.deptype = 'e'
)
select
  tc.relnamespace::regnamespace::text as schema,
  quote_ident(p.polname) as name,
  quote_ident(tc.relname) as table_name,
  p.polcmd as command,
  p.polpermissive as permissive,
  case
    when p.polroles = '{0}' then array['public']::text[]
    else array(
      select quote_ident(rolname)
      from pg_catalog.pg_roles
      where oid = any(p.polroles)
      order by rolname
    )
  end as roles,
  pg_get_expr(p.polqual, p.polrelid) as using_expression,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expression,
  tc.relowner::regrole::text as owner,
  obj_description(p.oid, 'pg_policy') as comment
from
  pg_catalog.pg_policy p
  inner join pg_catalog.pg_class tc on tc.oid = p.polrelid
  left outer join extension_policy_oids e_policy on p.oid = e_policy.objid
  left outer join extension_table_oids e_table on tc.oid = e_table.objid
  where not tc.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and e_policy.objid is null
  and e_table.objid is null
order by
  1, 2;
    `;
    // Validate and parse each row using the Zod schema
    const validatedRows = policyRows.map((row: unknown) =>
      rlsPolicyPropsSchema.parse(row),
    );
    return validatedRows.map((row: RlsPolicyProps) => new RlsPolicy(row));
  });
}
