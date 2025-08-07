import type { Sql } from "postgres";
import { BasePgModel } from "../base.model.ts";

export interface SequenceProps {
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

export class Sequence extends BasePgModel {
  public readonly schema: SequenceProps["schema"];
  public readonly name: SequenceProps["name"];
  public readonly data_type: SequenceProps["data_type"];
  public readonly start_value: SequenceProps["start_value"];
  public readonly minimum_value: SequenceProps["minimum_value"];
  public readonly maximum_value: SequenceProps["maximum_value"];
  public readonly increment: SequenceProps["increment"];
  public readonly cycle_option: SequenceProps["cycle_option"];
  public readonly cache_size: SequenceProps["cache_size"];
  public readonly persistence: SequenceProps["persistence"];
  public readonly owner: SequenceProps["owner"];

  constructor(props: SequenceProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.data_type = props.data_type;
    this.start_value = props.start_value;
    this.minimum_value = props.minimum_value;
    this.maximum_value = props.maximum_value;
    this.increment = props.increment;
    this.cycle_option = props.cycle_option;
    this.cache_size = props.cache_size;
    this.persistence = props.persistence;
    this.owner = props.owner;
  }

  get stableId(): `sequence:${string}` {
    return `sequence:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      data_type: this.data_type,
      start_value: this.start_value,
      minimum_value: this.minimum_value,
      maximum_value: this.maximum_value,
      increment: this.increment,
      cycle_option: this.cycle_option,
      cache_size: this.cache_size,
      persistence: this.persistence,
      owner: this.owner,
    };
  }
}

export async function extractSequences(sql: Sql): Promise<Sequence[]> {
  const sequenceRows = await sql<SequenceProps[]>`
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
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
  and c.relkind = 'S'
order by
  1, 2;
  `;
  return sequenceRows.map((row) => new Sequence(row));
}
