import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

// All properties exposed by CREATE INDEX statement are included in diff output.
// https://www.postgresql.org/docs/current/sql-createindex.html
//
// ALTER INDEX statement can only be generated for a subset of properties:
//  - name, tablespace, attach partition
// https://www.postgresql.org/docs/current/sql-alterindex.html
//
// Unsupported alter properties include
//  - storage param, statistics, depends on extension
//
// Other properties require dropping and creating a new index.
//  - operator class and param (i.indclass)
interface InspectedIndexRow {
  schema: string;
  name: string;
  table_schema: string;
  table_name: string;
  index_type: string;
  is_unique: boolean;
  is_primary: boolean;
  is_exclusion: boolean;
  nulls_not_distinct: boolean;
  immediate: boolean;
  is_clustered: boolean;
  is_replica_identity: boolean;
  key_columns: number[];
  column_collations: string[];
  column_options: number[];
  index_expressions: string | null;
  partial_predicate: string | null;
  owner: string;
}

export type InspectedIndex = InspectedIndexRow & DependentDatabaseObject;

function identifyIndex(index: InspectedIndexRow): string {
  return `${index.schema}.${index.table_name}.${index.name}`;
}

export async function inspectIndexes(
  sql: Sql,
): Promise<Map<string, InspectedIndex>> {
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
  c.relnamespace::regnamespace as schema,
  c.relname as name,
  tc.relnamespace::regnamespace as table_schema,
  tc.relname as table_name,
  am.amname as index_type,
  i.indisunique as is_unique,
  i.indisprimary as is_primary,
  i.indisexclusion as is_exclusion,
  i.indnullsnotdistinct as nulls_not_distinct,
  i.indimmediate as immediate,
  i.indisclustered as is_clustered,
  i.indisreplident as is_replica_identity,
  i.indkey as key_columns,
  i.indcollation::regcollation[] as column_collations,
  i.indoption as column_options,
  pg_get_expr(i.indexprs, i.indrelid) as index_expressions,
  pg_get_expr(i.indpred, i.indrelid) as partial_predicate,
  c.relowner::regrole as owner
from
  pg_catalog.pg_index i
  inner join pg_catalog.pg_class c on c.oid = i.indexrelid
  inner join pg_catalog.pg_class tc on tc.oid = i.indrelid
  inner join pg_catalog.pg_am am on am.oid = c.relam
  left outer join extension_oids e on c.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where not c.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and e.objid is null
  and indislive is true
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return new Map(
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
