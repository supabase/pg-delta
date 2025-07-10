import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

interface InspectedSchemaRow {
  schema: string;
  owner: string;
}

export type InspectedSchema = InspectedSchemaRow & DependentDatabaseObject;

function identifySchema(schema: InspectedSchemaRow): string {
  return schema.schema;
}

export async function inspectSchemas(
  sql: Sql,
): Promise<Map<string, InspectedSchema>> {
  const schemas = await sql<InspectedSchemaRow[]>`
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
  -- <EXCLUDE_INTERNAL>
  where nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and nspname not like 'pg\_temp\_%' and nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1;
  `;

  return new Map(
    schemas.map((s) => [
      identifySchema(s),
      { ...s, dependent_on: [], dependents: [] },
    ]),
  );
}
