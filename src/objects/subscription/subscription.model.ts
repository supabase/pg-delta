import type { Sql } from "postgres";
import z from "zod";
import { extractVersion } from "../../context.ts";
import { BasePgModel } from "../base.model.ts";

const subscriptionPropsSchema = z.object({
  name: z.string(),
  raw_name: z.string(),
  owner: z.string(),
  comment: z.string().nullable(),
  enabled: z.boolean(),
  binary: z.boolean(),
  streaming: z.enum(["off", "on", "parallel"]),
  two_phase: z.boolean(),
  disable_on_error: z.boolean(),
  password_required: z.boolean(),
  run_as_owner: z.boolean(),
  failover: z.boolean(),
  conninfo: z.string(),
  slot_name: z.string().nullable(),
  slot_is_none: z.boolean(),
  replication_slot_created: z.boolean(),
  synchronous_commit: z.string(),
  publications: z.array(z.string()),
  origin: z.enum(["any", "none"]),
});

export type SubscriptionProps = z.infer<typeof subscriptionPropsSchema>;

export class Subscription extends BasePgModel {
  public readonly name: SubscriptionProps["name"];
  public readonly raw_name: SubscriptionProps["raw_name"];
  public readonly owner: SubscriptionProps["owner"];
  public readonly comment: SubscriptionProps["comment"];
  public readonly enabled: SubscriptionProps["enabled"];
  public readonly binary: SubscriptionProps["binary"];
  public readonly streaming: SubscriptionProps["streaming"];
  public readonly two_phase: SubscriptionProps["two_phase"];
  public readonly disable_on_error: SubscriptionProps["disable_on_error"];
  public readonly password_required: SubscriptionProps["password_required"];
  public readonly run_as_owner: SubscriptionProps["run_as_owner"];
  public readonly failover: SubscriptionProps["failover"];
  public readonly conninfo: SubscriptionProps["conninfo"];
  public readonly slot_name: SubscriptionProps["slot_name"];
  public readonly slot_is_none: SubscriptionProps["slot_is_none"];
  public readonly replication_slot_created: SubscriptionProps["replication_slot_created"];
  public readonly synchronous_commit: SubscriptionProps["synchronous_commit"];
  public readonly publications: SubscriptionProps["publications"];
  public readonly origin: SubscriptionProps["origin"];

  constructor(props: SubscriptionProps) {
    super();

    this.name = props.name;
    this.raw_name = props.raw_name;
    this.owner = props.owner;
    this.comment = props.comment;
    this.enabled = props.enabled;
    this.binary = props.binary;
    this.streaming = props.streaming;
    this.two_phase = props.two_phase;
    this.disable_on_error = props.disable_on_error;
    this.password_required = props.password_required;
    this.run_as_owner = props.run_as_owner;
    this.failover = props.failover;
    this.conninfo = props.conninfo;
    this.slot_name = props.slot_name;
    this.slot_is_none = props.slot_is_none;
    this.replication_slot_created = props.replication_slot_created;
    this.synchronous_commit = props.synchronous_commit;
    this.publications = [...props.publications].sort((a, b) =>
      a.localeCompare(b),
    );
    this.origin = props.origin;
  }

  get stableId(): `subscription:${string}` {
    return `subscription:${this.name}`;
  }

  get identityFields() {
    return {
      name: this.name,
    };
  }

  get dataFields() {
    return {
      raw_name: this.raw_name,
      owner: this.owner,
      comment: this.comment,
      enabled: this.enabled,
      binary: this.binary,
      streaming: this.streaming,
      two_phase: this.two_phase,
      disable_on_error: this.disable_on_error,
      password_required: this.password_required,
      run_as_owner: this.run_as_owner,
      failover: this.failover,
      conninfo: this.conninfo,
      slot_name: this.slot_name,
      slot_is_none: this.slot_is_none,
      replication_slot_created: this.replication_slot_created,
      synchronous_commit: this.synchronous_commit,
      publications: this.publications,
      origin: this.origin,
    };
  }
}

export async function extractSubscriptions(sql: Sql): Promise<Subscription[]> {
  return sql.begin(async (tx) => {
    await tx`set search_path = ''`;
    const version = await extractVersion(tx);
    const isPostgres16OrGreater = version >= 160000;
    const isPostgres17OrGreater = version >= 170000;
    const isPostgres17_2OrGreater = version >= 170002; // failover added in 17.2 (170002)
    const isPostgres17_3OrGreater = version >= 170003; // origin column added in 17.3
    const rows = await tx`
      with extension_oids as (
        select objid
        from pg_depend d
        where d.refclassid = 'pg_extension'::regclass
          and d.classid = 'pg_subscription'::regclass
      ),
      scoped_subscriptions as (
        select s.*
        from pg_subscription s
        where s.subdbid = (select oid from pg_database where datname = current_database())
      )
      select
        quote_ident(s.subname) as name,
        s.subname::text as raw_name,
        s.subowner::regrole::text as owner,
        obj_description(s.oid, 'pg_subscription') as comment,
        s.subenabled as enabled,
        s.subbinary as binary,
        case s.substream::text
          when 'f' then 'off'
          when 't' then 'on'
          when 'p' then 'parallel'
          else 'off'
        end as streaming,
        (s.subtwophasestate <> 'd') as two_phase,
        s.subdisableonerr as disable_on_error,
        ${isPostgres16OrGreater ? tx` s.subpasswordrequired ` : tx` true `} as password_required,
        ${isPostgres17OrGreater ? tx` s.subrunasowner ` : tx` false `} as run_as_owner,
        ${isPostgres17_2OrGreater ? tx` s.subfailover ` : tx` false `} as failover,
        s.subconninfo as conninfo,
        case
          when s.subslotname is null then null
          when s.subslotname = s.subname then null
          else s.subslotname::text
        end as slot_name,
        s.subslotname is null as slot_is_none,
        (r.slot_name is not null) as replication_slot_created,
        s.subsynccommit as synchronous_commit,
        coalesce(
          (
            select json_agg(quote_ident(pub) order by quote_ident(pub))
            from unnest(s.subpublications) as pub
          ),
          '[]'::json
        ) as publications,
        ${
          isPostgres17_3OrGreater
            ? tx` case s.suborigin when 'none' then 'none' else 'any' end `
            : tx` 'any' `
        } as origin
      from scoped_subscriptions s
      left join pg_replication_slots r
        on r.slot_name = s.subslotname
       and r.datoid = s.subdbid
      left join extension_oids e on e.objid = s.oid
      where e.objid is null
      order by s.subname;
    `;

    const validated = rows.map((row) => subscriptionPropsSchema.parse(row));
    return validated.map((row) => new Subscription(row));
  });
}
