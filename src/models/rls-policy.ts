import type { Sql } from "postgres";
import { BasePgModel } from "./base.ts";

type RlsPolicyCommand = "r" | "a" | "w" | "d" | "*";

interface RlsPolicyProps {
  schema: string;
  name: string;
  table_schema: string;
  table_name: string;
  command: RlsPolicyCommand;
  permissive: boolean;
  roles: string[];
  using_expression: string | null;
  with_check_expression: string | null;
  owner: string;
}

export class RlsPolicy extends BasePgModel {
  public readonly schema: RlsPolicyProps["schema"];
  public readonly name: RlsPolicyProps["name"];
  public readonly table_schema: RlsPolicyProps["table_schema"];
  public readonly table_name: RlsPolicyProps["table_name"];
  public readonly command: RlsPolicyProps["command"];
  public readonly permissive: RlsPolicyProps["permissive"];
  public readonly roles: RlsPolicyProps["roles"];
  public readonly using_expression: RlsPolicyProps["using_expression"];
  public readonly with_check_expression: RlsPolicyProps["with_check_expression"];
  public readonly owner: RlsPolicyProps["owner"];

  constructor(props: RlsPolicyProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;
    this.table_schema = props.table_schema;
    this.table_name = props.table_name;

    // Data fields
    this.command = props.command;
    this.permissive = props.permissive;
    this.roles = props.roles;
    this.using_expression = props.using_expression;
    this.with_check_expression = props.with_check_expression;
    this.owner = props.owner;
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
    };
  }
}

export async function extractRlsPolicies(sql: Sql): Promise<RlsPolicy[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const policyRows = await sql<RlsPolicyProps[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_policy'::regclass
)
select
  n.nspname as schema,
  p.polname as name,
  tn.nspname as table_schema,
  tc.relname as table_name,
  p.polcmd as command,
  p.polpermissive as permissive,
  array(
    select r.rolname
    from pg_roles r
    where r.oid = any(p.polroles)
  ) as roles,
  pg_get_expr(p.polqual, p.polrelid) as using_expression,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expression,
  pg_get_userbyid(tc.relowner) as owner
from
  pg_catalog.pg_policy p
  inner join pg_catalog.pg_class tc on tc.oid = p.polrelid
  inner join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
  inner join pg_catalog.pg_namespace n on n.oid = tc.relnamespace
  left outer join extension_oids e on p.oid = e.objid
  where tn.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and tn.nspname not like 'pg\_temp\_%' and tn.nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
order by
  1, 2;
    `;
    return policyRows.map((row) => new RlsPolicy(row));
  });
}
