import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";
import type { ReplicaIdentity } from "./tables.ts";

export interface InspectedViewRow {
  schema: string;
  name: string;
  definition: string | null;
  row_security: boolean;
  force_row_security: boolean;
  has_indexes: boolean;
  has_rules: boolean;
  has_triggers: boolean;
  has_subclasses: boolean;
  is_populated: boolean;
  replica_identity: ReplicaIdentity;
  is_partition: boolean;
  options: string[] | null;
  partition_bound: string | null;
  owner: string;
}

export type InspectedView = InspectedViewRow & DependentDatabaseObject;

export function identifyView(view: InspectedViewRow): string {
  return `${view.schema}.${view.name}`;
}

export async function inspectViews(
  sql: Sql,
): Promise<Map<string, InspectedView>> {
  const views = await sql<InspectedViewRow[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
)
select
  n.nspname as schema,
  c.relname as name,
  pg_get_viewdef(c.oid) as definition,
  c.relrowsecurity as row_security,
  c.relforcerowsecurity as force_row_security,
  c.relhasindex as has_indexes,
  c.relhasrules as has_rules,
  c.relhastriggers as has_triggers,
  c.relhassubclass as has_subclasses,
  c.relispopulated as is_populated,
  c.relreplident as replica_identity,
  c.relispartition as is_partition,
  c.reloptions as options,
  pg_get_expr(c.relpartbound, c.oid) as partition_bound,
  pg_get_userbyid(c.relowner) as owner
from
  pg_catalog.pg_class c
  inner join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left outer join extension_oids e on c.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
  and e.objid is null
  and c.relkind = 'v'
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return new Map(
    views.map((view) => [
      identifyView(view),
      {
        ...view,
        dependent_on: [],
        dependents: [],
      },
    ]),
  );
}
