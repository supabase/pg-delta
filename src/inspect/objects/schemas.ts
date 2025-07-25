import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

// All properties exposed by CREATE SCHEMA statement are included in diff output.
// https://www.postgresql.org/docs/current/sql-createschema.html
//
// ALTER SCHEMA statement can be generated for all properties.
// https://www.postgresql.org/docs/current/sql-alterschema.html
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
): Promise<Record<string, InspectedSchema>> {
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
  nspowner::regrole as owner
from
  pg_catalog.pg_namespace
  left outer join extension_oids e on e.objid = oid
  -- <EXCLUDE_INTERNAL>
  where not nspname like any(array['pg\\_%', 'information\\_schema'])
  and e.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1;
  `;

  return Object.fromEntries(
    schemas.map((s) => [
      identifySchema(s),
      {
        ...s,
        dependent_on: [],
        dependents: [],
      },
    ]),
  );
}
