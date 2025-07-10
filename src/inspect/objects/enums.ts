import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

// All properties exposed by CREATE TYPE AS ENUM statement are included in diff output.
// https://www.postgresql.org/docs/current/sql-createtype.html
//
// ALTER TYPE statement can be generated for changes to the following properties:
//  - name, owner, schema, add or rename value
// https://www.postgresql.org/docs/current/sql-altertype.html
//
// Sort order of values may be negative or fractional.
// https://www.postgresql.org/docs/current/catalog-pg-enum.html
//
// Type ACL will be supported separately.
// https://www.postgresql.org/docs/current/ddl-priv.html
interface InspectedEnumRow {
  schema: string;
  name: string;
  owner: string;
  sort_order: number;
  label: string;
}

type InspectedEnumLabel = Pick<InspectedEnumRow, "sort_order" | "label">;

export interface InspectedEnum
  extends Omit<InspectedEnumRow, keyof InspectedEnumLabel>,
    DependentDatabaseObject {
  labels: InspectedEnumLabel[];
}

export async function inspectEnums(
  sql: Sql,
): Promise<Map<string, InspectedEnum>> {
  const enums = await sql<InspectedEnumRow[]>`
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
  t.typnamespace::regnamespace as schema,
  t.typname as name,
  e.enumsortorder as sort_order,
  e.enumlabel as label,
  t.typowner::regrole as owner
from
  pg_catalog.pg_enum e
  inner join pg_catalog.pg_type t on t.oid = e.enumtypid
  left outer join extension_oids ext on t.oid = ext.objid
  -- <EXCLUDE_INTERNAL>
  where not t.typnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and ext.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1, 2, 3;
  `;

  const grouped = new Map<string, InspectedEnum>();
  for (const e of enums) {
    const key = identifyEnum(e);
    let obj = grouped.get(key);
    if (!obj) {
      obj = {
        schema: e.schema,
        name: e.name,
        owner: e.owner,
        dependent_on: [],
        dependents: [],
        labels: [],
      };
      grouped.set(key, obj);
    }
    obj.labels.push({ sort_order: e.sort_order, label: e.label });
  }
  return grouped;
}

function identifyEnum(
  enum_: Pick<InspectedEnumRow, "schema" | "name">,
): string {
  return `${enum_.schema}.${enum_.name}`;
}
