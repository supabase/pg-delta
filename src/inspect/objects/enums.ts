import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

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
  n.nspname as schema,
  t.typname as name,
  e.enumsortorder as sort_order,
  e.enumlabel as label,
  pg_get_userbyid(t.typowner) as owner
from
  pg_catalog.pg_enum e
  inner join pg_catalog.pg_type t on t.oid = e.enumtypid
  inner join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  left outer join extension_oids ext on t.oid = ext.objid
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
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
