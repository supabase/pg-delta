import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const EventTriggerEnabledSchema = z.enum([
  "O", // ORIGIN - trigger fires in origin mode
  "D", // DISABLED - trigger does not fire
  "R", // REPLICA - trigger fires only in replica session
  "A", // ALWAYS - trigger fires regardless of replication mode
]);

const eventTriggerPropsSchema = z.object({
  name: z.string(),
  event: z.string(),
  function_schema: z.string(),
  function_name: z.string(),
  enabled: EventTriggerEnabledSchema,
  tags: z.array(z.string()).nullable(),
  owner: z.string(),
  comment: z.string().nullable(),
});

export type EventTriggerProps = z.infer<typeof eventTriggerPropsSchema>;

export class EventTrigger extends BasePgModel {
  public readonly name: EventTriggerProps["name"];
  public readonly event: EventTriggerProps["event"];
  public readonly function_schema: EventTriggerProps["function_schema"];
  public readonly function_name: EventTriggerProps["function_name"];
  public readonly enabled: EventTriggerProps["enabled"];
  public readonly tags: EventTriggerProps["tags"];
  public readonly owner: EventTriggerProps["owner"];
  public readonly comment: EventTriggerProps["comment"];

  constructor(props: EventTriggerProps) {
    super();

    // Identity fields
    this.name = props.name;

    // Data fields
    this.event = props.event;
    this.function_schema = props.function_schema;
    this.function_name = props.function_name;
    this.enabled = props.enabled;
    this.tags = props.tags;
    this.owner = props.owner;
    this.comment = props.comment;
  }

  get stableId(): `eventTrigger:${string}` {
    return `eventTrigger:${this.name}`;
  }

  get identityFields() {
    return {
      name: this.name,
    };
  }

  get dataFields() {
    return {
      event: this.event,
      function_schema: this.function_schema,
      function_name: this.function_name,
      enabled: this.enabled,
      tags: this.tags,
      owner: this.owner,
      comment: this.comment,
    };
  }
}

export async function extractEventTriggers(sql: Sql): Promise<EventTrigger[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const rows = await sql`
with extension_oids as (
  select objid
  from pg_depend d
  where d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_event_trigger'::regclass
)
select
  quote_ident(et.evtname) as name,
  et.evtevent as event,
  p.pronamespace::regnamespace::text as function_schema,
  quote_ident(p.proname) as function_name,
  et.evtenabled as enabled,
  et.evttags as tags,
  et.evtowner::regrole::text as owner,
  obj_description(et.oid, 'pg_event_trigger') as comment
from pg_catalog.pg_event_trigger et
join pg_catalog.pg_proc p on p.oid = et.evtfoid
left join extension_oids e on e.objid = et.oid
where e.objid is null
order by 1;
    `;

    const validatedRows = rows.map((row: unknown) =>
      eventTriggerPropsSchema.parse(row),
    );

    return validatedRows.map((row: EventTriggerProps) => new EventTrigger(row));
  });
}
