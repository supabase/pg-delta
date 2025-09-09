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
  owned_by_schema: z.string().nullable(),
  owned_by_table: z.string().nullable(),
  owned_by_column: z.string().nullable(),
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
  public readonly owned_by_schema: SequenceProps["owned_by_schema"];
  public readonly owned_by_table: SequenceProps["owned_by_table"];
  public readonly owned_by_column: SequenceProps["owned_by_column"];

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
    this.owned_by_schema = props.owned_by_schema;
    this.owned_by_table = props.owned_by_table;
    this.owned_by_column = props.owned_by_column;
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
      owned_by_schema: this.owned_by_schema,
      owned_by_table: this.owned_by_table,
      owned_by_column: this.owned_by_column,
    };
  }
}

export async function extractSequences(sql: Sql): Promise<Sequence[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
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
  quote_ident(t_ns.nspname) as owned_by_schema,
  case when t.relname is not null then quote_ident(t.relname) else null end as owned_by_table,
  case when att.attname is not null then quote_ident(att.attname) else null end as owned_by_column
from
  pg_catalog.pg_class c
  inner join pg_catalog.pg_sequence s on s.seqrelid = c.oid
  left join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = c.oid and d.refclassid = 'pg_class'::regclass and d.deptype = 'a'
  left join pg_class t on t.oid = d.refobjid
  left join pg_namespace t_ns on t.relnamespace = t_ns.oid
  left join pg_attribute att on att.attrelid = t.oid and att.attnum = d.refobjsubid and d.refobjsubid > 0
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
  });
}
