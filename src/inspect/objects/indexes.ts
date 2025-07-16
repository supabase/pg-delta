import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

// All properties exposed by CREATE INDEX statement are included in diff output.
// https://www.postgresql.org/docs/current/sql-createindex.html
//
// ALTER INDEX statement can only be generated for a subset of properties:
//  - name, storage param, statistics, tablespace, attach partition
// https://www.postgresql.org/docs/current/sql-alterindex.html
//
// Unsupported alter properties include
//  - depends on extension (all extension dependencies are excluded)
//
// Other properties require dropping and creating a new index.
interface InspectedIndexRow {
  table_schema: string;
  table_name: string;
  name: string;
  storage_params: string[];
  statistics_target: number[];
  index_type: string;
  tablespace: string | null;
  is_unique: boolean;
  is_primary: boolean;
  is_exclusion: boolean;
  nulls_not_distinct: boolean;
  immediate: boolean;
  is_clustered: boolean;
  is_replica_identity: boolean;
  key_columns: number[];
  column_collations: string[];
  operator_classes: string[];
  column_options: number[];
  index_expressions: string | null;
  partial_predicate: string | null;
}

export type InspectedIndex = InspectedIndexRow & DependentDatabaseObject;

function identifyIndex(index: InspectedIndexRow): string {
  return `${index.table_schema}.${index.table_name}.${index.name}`;
}

export async function inspectIndexes(
  sql: Sql,
): Promise<Record<string, InspectedIndex>> {
  const indexes = await sql<InspectedIndexRow[]>`
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
  tc.relnamespace::regnamespace as table_schema,
  tc.relname as table_name,
  c.relname as name,
  coalesce(c.reloptions, array[]::text[]) as storage_params,
  am.amname as index_type,
  ts.spcname as tablespace,
  i.indisunique as is_unique,
  i.indisprimary as is_primary,
  i.indisexclusion as is_exclusion,
  i.indnullsnotdistinct as nulls_not_distinct,
  i.indimmediate as immediate,
  i.indisclustered as is_clustered,
  i.indisreplident as is_replica_identity,
  i.indkey as key_columns,
  i.indcollation::regcollation[] as column_collations,
  array(
    select coalesce(attstattarget, -1)
    from pg_catalog.pg_attribute a
    where a.attrelid = i.indexrelid
  ) as statistics_target,
  array(
    select format('%I.%I', opcnamespace::regnamespace, opcname)
    from unnest(i.indclass) op
    left join pg_opclass oc on oc.oid = op
  ) as operator_classes,
  i.indoption as column_options,
  pg_get_expr(i.indexprs, i.indrelid) as index_expressions,
  pg_get_expr(i.indpred, i.indrelid) as partial_predicate
from
  pg_catalog.pg_index i
  inner join pg_catalog.pg_class tc on tc.oid = i.indrelid
  inner join pg_catalog.pg_class c on c.oid = i.indexrelid
  inner join pg_catalog.pg_am am on am.oid = c.relam
  left join pg_catalog.pg_tablespace ts on ts.oid = c.reltablespace
  left outer join extension_oids e on c.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where not c.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and i.indislive is true
  and e.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return Object.fromEntries(
    indexes.map((i) => [
      identifyIndex(i),
      {
        ...i,
        dependent_on: [],
        dependents: [],
      },
    ]),
  );
}
