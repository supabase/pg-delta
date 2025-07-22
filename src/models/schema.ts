import type { Sql } from "postgres";
import { BasePgModel } from "./base.ts";

interface SchemaProps {
  schema: string;
  owner: string;
}

export class Schema extends BasePgModel {
  public readonly schema: SchemaProps["schema"];
  public readonly owner: SchemaProps["owner"];

  constructor(props: SchemaProps) {
    super();

    // Identity fields
    this.schema = props.schema;

    // Data fields
    this.owner = props.owner;
  }

  get stableId(): `schema:${string}` {
    return `schema:${this.schema}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
    };
  }

  get dataFields() {
    return {
      owner: this.owner,
    };
  }
}

export async function extractSchemas(sql: Sql): Promise<Schema[]> {
  const schemaRows = await sql<SchemaProps[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_namespace'::regclass
)
select
  nspname as schema,
  pg_get_userbyid(nspowner) as owner
from
  pg_catalog.pg_namespace
  left outer join extension_oids e on e.objid = oid
  where nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and nspname not like 'pg\_temp\_%' and nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
order by
  1;
  `;
  return schemaRows.map((row) => new Schema(row));
}
