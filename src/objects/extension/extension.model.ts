import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

/**
 * All properties exposed by CREATE EXTENSION statement are included in diff output.
 * https://www.postgresql.org/docs/current/sql-createextension.html
 *
 * ALTER EXTENSION statement can be generated for changes to the following properties:
 *  - version (limited to available ones), schema (only if relocatable)
 * https://www.postgresql.org/docs/current/sql-alterextension.html
 *
 * Adding or dropping member objects are not supported. For eg. pgmq allows detaching
 * user defined queues by removing its entry from pg_depend. If the detached table
 * lives in an excluded schema like pg_catalog, it will not be diffed.
 *
 * The extension's configuration tables are not diffed.
 *  - extconfig, extcondition
 * https://www.postgresql.org/docs/current/catalog-pg-extension.html
 */
const extensionPropsSchema = z.object({
  name: z.string(),
  schema: z.string(),
  relocatable: z.boolean(),
  version: z.string(),
  owner: z.string(),
  comment: z.string().nullable(),
  members: z.array(z.string()),
});

export type ExtensionProps = z.infer<typeof extensionPropsSchema>;

export class Extension extends BasePgModel {
  public readonly name: ExtensionProps["name"];
  public readonly schema: ExtensionProps["schema"];
  public readonly relocatable: ExtensionProps["relocatable"];
  public readonly version: ExtensionProps["version"];
  public readonly owner: ExtensionProps["owner"];
  public readonly comment: ExtensionProps["comment"];
  public readonly members: ExtensionProps["members"];

  constructor(props: ExtensionProps) {
    super();

    // Identity fields
    this.name = props.name;

    // Data fields
    this.schema = props.schema;
    this.relocatable = props.relocatable;
    this.version = props.version;
    this.owner = props.owner;
    this.comment = props.comment;
    this.members = props.members;
  }

  get stableId(): `extension:${string}` {
    // Extension names are unique per database; schema is relocatable
    return `extension:${this.name}`;
  }

  get identityFields() {
    return {
      name: this.name,
    };
  }

  get dataFields() {
    return {
      schema: this.schema,
      relocatable: this.relocatable,
      version: this.version,
      owner: this.owner,
      comment: this.comment,
    };
  }
}

// TODO: fetch extension dependencies so we can determine when to use CASCADE on creation
export async function extractExtensions(sql: Sql): Promise<Extension[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const extensionRows = await sql`
  with extension_rows as (
    select
      e.oid,
      quote_ident(e.extname) as name,
      e.extnamespace::regnamespace::text as schema,
      e.extrelocatable as relocatable,
      e.extversion as version,
      e.extowner::regrole::text as owner,
      obj_description(e.oid, 'pg_extension') as comment
    from
      pg_catalog.pg_extension e
  ), extension_members_raw as (
    select
      er.oid as extension_oid,
      d.classid,
      d.objid,
      d.objsubid
    from
      extension_rows er
      join pg_depend d on d.refclassid = 'pg_extension'::regclass
        and d.refobjid = er.oid
    where
      d.deptype = 'e'
  ), ids as (
    select distinct
      classid,
      objid,
      coalesce(nullif(objsubid, 0), 0)::int2 as objsubid
    from extension_members_raw
  ), objects as (
    select 'pg_namespace'::regclass as classid, n.oid as objid, 0::int2 as objsubid,
          format('schema:%I', n.nspname) as stable_id
    from pg_namespace n
    join ids i on i.classid = 'pg_namespace'::regclass and i.objid = n.oid and i.objsubid = 0

    union all

    select 'pg_class'::regclass, c.oid, 0::int2,
          case c.relkind
            when 'r' then format('table:%I.%I', ns.nspname, c.relname)
            when 'p' then format('table:%I.%I', ns.nspname, c.relname)
            when 'v' then format('view:%I.%I', ns.nspname, c.relname)
            when 'm' then format('materializedView:%I.%I', ns.nspname, c.relname)
            when 'S' then format('sequence:%I.%I', ns.nspname, c.relname)
            when 'i' then format('index:%I.%I.%I', ns.nspname, tbl.relname, c.relname)
            when 'c' then format('type:%I.%I', ns.nspname, c.relname)
            else format('unknown:%s.%s', 'pg_class', c.oid::text)
          end as stable_id
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    left join pg_index idx on idx.indexrelid = c.oid
    left join pg_class tbl on tbl.oid = idx.indrelid
    join ids i on i.classid = 'pg_class'::regclass and i.objid = c.oid and i.objsubid = 0

    union all

    select 'pg_class'::regclass, a.attrelid, a.attnum,
          format('column:%I.%I.%I', ns.nspname, c.relname, a.attname) as stable_id
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join ids i on i.classid = 'pg_class'::regclass and i.objid = a.attrelid and i.objsubid = a.attnum
    where a.attnum > 0 and not a.attisdropped

    union all

    select 'pg_type'::regclass, t.oid, 0::int2,
          case t.typtype
            when 'd' then format('domain:%I.%I', ns.nspname, t.typname)
            when 'e' then format('type:%I.%I', ns.nspname, t.typname)
            when 'r' then format('type:%I.%I', ns.nspname, t.typname)
            when 'm' then format('multirange:%I.%I', ns.nspname, t.typname)
            when 'c' then
              case
                when r.oid is not null and r.relkind in ('r','p','f') then format('table:%I.%I', rns.nspname, r.relname)
                when r.oid is not null and r.relkind = 'v' then format('view:%I.%I', rns.nspname, r.relname)
                when r.oid is not null and r.relkind = 'm' then format('materializedView:%I.%I', rns.nspname, r.relname)
                else format('type:%I.%I', ns.nspname, t.typname)
              end
            when 'p' then format('pseudoType:%I.%I', ns.nspname, t.typname)
            else format('type:%I.%I', ns.nspname, t.typname)
          end as stable_id
    from pg_type t
    join pg_namespace ns on ns.oid = t.typnamespace
    left join pg_class r on r.oid = t.typrelid
    left join pg_namespace rns on rns.oid = r.relnamespace
    join ids i on i.classid = 'pg_type'::regclass and i.objid = t.oid and i.objsubid = 0

    union all

    select 'pg_constraint'::regclass, c.oid, 0::int2,
          case
            when c.contypid <> 0 then format('constraint:%I.%I.%I', ns.nspname, ty.typname, c.conname)
            when c.conrelid <> 0 then format('constraint:%I.%I.%I', tbl_ns.nspname, tbl.relname, c.conname)
            else format('constraint:%s', c.oid::text)
          end as stable_id
    from pg_constraint c
    left join pg_type ty on ty.oid = c.contypid
    left join pg_namespace ns on ns.oid = ty.typnamespace
    left join pg_class tbl on tbl.oid = c.conrelid
    left join pg_namespace tbl_ns on tbl_ns.oid = tbl.relnamespace
    join ids i on i.classid = 'pg_constraint'::regclass and i.objid = c.oid and i.objsubid = 0

    union all

    select 'pg_proc'::regclass, p.oid, 0::int2,
          format(
            'procedure:%I.%I(%s)',
            ns.nspname,
            p.proname,
            coalesce((select string_agg(format_type(oid, null), ',' order by ord)
              from unnest(p.proargtypes) with ordinality as t(oid, ord)), '')
          ) as stable_id
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join ids i on i.classid = 'pg_proc'::regclass and i.objid = p.oid and i.objsubid = 0

    union all

    select 'pg_trigger'::regclass, tg.oid, 0::int2,
          format('trigger:%I.%I.%I', ns.nspname, tbl.relname, tg.tgname) as stable_id
    from pg_trigger tg
    join pg_class tbl on tbl.oid = tg.tgrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    join ids i on i.classid = 'pg_trigger'::regclass and i.objid = tg.oid and i.objsubid = 0

    union all

    select 'pg_collation'::regclass, c.oid, 0::int2,
          format('collation:%I.%I', ns.nspname, c.collname) as stable_id
    from pg_collation c
    join pg_namespace ns on ns.oid = c.collnamespace
    join ids i on i.classid = 'pg_collation'::regclass and i.objid = c.oid and i.objsubid = 0

    union all

    select 'pg_event_trigger'::regclass, et.oid, 0::int2,
          format('eventTrigger:%I', et.evtname) as stable_id
    from pg_event_trigger et
    join ids i on i.classid = 'pg_event_trigger'::regclass and i.objid = et.oid and i.objsubid = 0

    union all

    select 'pg_ts_config'::regclass, cfg.oid, 0::int2,
          format('tsConfig:%I.%I', ns.nspname, cfg.cfgname) as stable_id
    from pg_ts_config cfg
    join pg_namespace ns on ns.oid = cfg.cfgnamespace
    join ids i on i.classid = 'pg_ts_config'::regclass and i.objid = cfg.oid and i.objsubid = 0

    union all

    select 'pg_ts_dict'::regclass, dict.oid, 0::int2,
          format('tsDict:%I.%I', ns.nspname, dict.dictname) as stable_id
    from pg_ts_dict dict
    join pg_namespace ns on ns.oid = dict.dictnamespace
    join ids i on i.classid = 'pg_ts_dict'::regclass and i.objid = dict.oid and i.objsubid = 0

    union all

    select 'pg_ts_template'::regclass, tmpl.oid, 0::int2,
          format('tsTemplate:%I.%I', ns.nspname, tmpl.tmplname) as stable_id
    from pg_ts_template tmpl
    join pg_namespace ns on ns.oid = tmpl.tmplnamespace
    join ids i on i.classid = 'pg_ts_template'::regclass and i.objid = tmpl.oid and i.objsubid = 0
  ), extension_members as (
    select
      em.extension_oid,
      obj.stable_id
    from extension_members_raw em
    join objects obj
      on obj.classid = em.classid
      and obj.objid = em.objid
      and obj.objsubid = coalesce(nullif(em.objsubid, 0), 0)
  )
  select
    er.name,
    er.schema,
    er.relocatable,
    er.version,
    er.owner,
    er.comment,
    coalesce(
      (
        select json_agg(em.stable_id order by em.stable_id)
        from extension_members em
        where em.extension_oid = er.oid
      ), '[]'::json
    ) as members
  from extension_rows er
  order by
    er.name;
  `;
    // Validate and parse each row using the Zod schema
    const validatedRows = extensionRows.map((row: unknown) =>
      extensionPropsSchema.parse(row),
    );
    return validatedRows.map((row: ExtensionProps) => new Extension(row));
  });
}
