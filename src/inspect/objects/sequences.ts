import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

interface InspectedSequenceRow {
  schema: string;
  name: string;
  data_type: string;
  start_value: number;
  minimum_value: number;
  maximum_value: number;
  increment: number;
  cycle_option: boolean;
  cache_size: number;
  persistence: string;
  owner: string;
}

export type InspectedSequence = InspectedSequenceRow & DependentDatabaseObject;

function identifySequence(seq: InspectedSequenceRow): string {
  return `${seq.schema}.${seq.name}`;
}

export async function inspectSequences(
  sql: Sql,
): Promise<Map<string, InspectedSequence>> {
  const sequences = await sql<InspectedSequenceRow[]>`
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
  format_type(s.seqtypid, null) as data_type,
  s.seqstart as start_value,
  s.seqmin as minimum_value,
  s.seqmax as maximum_value,
  s.seqincrement as increment,
  s.seqcycle as cycle_option,
  s.seqcache as cache_size,
  c.relpersistence as persistence,
  pg_get_userbyid(c.relowner) as owner
from
  pg_catalog.pg_class c
  inner join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  inner join pg_catalog.pg_sequence s on s.seqrelid = c.oid
  left outer join extension_oids e on c.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
  and c.relkind = 'S'
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return new Map(
    sequences.map((s) => [
      identifySequence(s),
      {
        ...s,
        dependent_on: [],
        dependents: [],
      },
    ]),
  );
}
