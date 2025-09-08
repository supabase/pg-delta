import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const sequencePropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  data_type: z.string(),
  start_value: z.number(),
  minimum_value: z.bigint(),
  maximum_value: z.bigint(),
  increment: z.number(),
  cycle_option: z.boolean(),
  cache_size: z.number(),
  persistence: z.string(),
  owner: z.string(),
});

export type SequenceProps = z.infer<typeof sequencePropsSchema>;

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
  const sequenceRows = await sql`
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
  c.relnamespace::regnamespace::text as schema,
  quote_ident(c.relname) as name,
  format_type(s.seqtypid, null) as data_type,
  s.seqstart::int as start_value,
  s.seqmin as minimum_value,
  s.seqmax as maximum_value,
  s.seqincrement::int as increment,
  s.seqcycle as cycle_option,
  s.seqcache::int as cache_size,
  c.relpersistence as persistence,
  c.relowner::regrole::text as owner
from
  pg_catalog.pg_class c
  inner join pg_catalog.pg_sequence s on s.seqrelid = c.oid
  left outer join extension_oids e on c.oid = e.objid
  where not c.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and e.objid is null
  and c.relkind = 'S'
order by
  1, 2;
  `;
  // Validate and parse each row using the Zod schema
  const validatedRows = sequenceRows.map((row: unknown) =>
    sequencePropsSchema.parse(row),
  );
  return validatedRows.map((row: SequenceProps) => new Sequence(row));
}
