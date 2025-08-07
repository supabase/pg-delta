import type { Sql } from "postgres";
import { BasePgModel } from "../base.model.ts";

export type ReplicaIdentity =
  /** DEFAULT */
  | "d"
  /** NOTHING */
  | "n"
  /** FULL */
  | "f"
  /** INDEX */
  | "i";

export interface CompositeTypeProps {
  schema: string;
  name: string;
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

export class CompositeType extends BasePgModel {
  public readonly schema: CompositeTypeProps["schema"];
  public readonly name: CompositeTypeProps["name"];
  public readonly row_security: CompositeTypeProps["row_security"];
  public readonly force_row_security: CompositeTypeProps["force_row_security"];
  public readonly has_indexes: CompositeTypeProps["has_indexes"];
  public readonly has_rules: CompositeTypeProps["has_rules"];
  public readonly has_triggers: CompositeTypeProps["has_triggers"];
  public readonly has_subclasses: CompositeTypeProps["has_subclasses"];
  public readonly is_populated: CompositeTypeProps["is_populated"];
  public readonly replica_identity: CompositeTypeProps["replica_identity"];
  public readonly is_partition: CompositeTypeProps["is_partition"];
  public readonly options: CompositeTypeProps["options"];
  public readonly partition_bound: CompositeTypeProps["partition_bound"];
  public readonly owner: CompositeTypeProps["owner"];

  constructor(props: CompositeTypeProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.row_security = props.row_security;
    this.force_row_security = props.force_row_security;
    this.has_indexes = props.has_indexes;
    this.has_rules = props.has_rules;
    this.has_triggers = props.has_triggers;
    this.has_subclasses = props.has_subclasses;
    this.is_populated = props.is_populated;
    this.replica_identity = props.replica_identity;
    this.is_partition = props.is_partition;
    this.options = props.options;
    this.partition_bound = props.partition_bound;
    this.owner = props.owner;
  }

  get stableId(): `compositeType:${string}` {
    return `compositeType:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      row_security: this.row_security,
      force_row_security: this.force_row_security,
      has_indexes: this.has_indexes,
      has_rules: this.has_rules,
      has_triggers: this.has_triggers,
      has_subclasses: this.has_subclasses,
      is_populated: this.is_populated,
      replica_identity: this.replica_identity,
      is_partition: this.is_partition,
      options: this.options,
      partition_bound: this.partition_bound,
      owner: this.owner,
    };
  }
}

export async function extractCompositeTypes(
  sql: Sql,
): Promise<CompositeType[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;

    const compositeTypeRows = await sql<CompositeTypeProps[]>`
      with extension_oids as (
        select
          objid
        from
          pg_depend d
        where
          d.refclassid = 'pg_extension'::regclass
          and d.classid = 'pg_class'::regclass
      ), enums as (
        select
          t.oid as enum_oid,
          n.nspname as enum_schema,
          t.typname as enum_name
        from pg_type t
        left join pg_namespace n on n.oid = t.typnamespace
        left join extension_oids e on t.oid = e.objid
        where t.typcategory = 'E'
          and e.objid is null
      ), composite_types as (
        select
          n.nspname as schema,
          c.relname as name,
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
          pg_get_userbyid(c.relowner) as owner,
          c.oid as oid
        from
          pg_catalog.pg_class c
          inner join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          left outer join extension_oids e on c.oid = e.objid
        where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
          and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
          and e.objid is null
          and c.relkind = 'c'
      )
      select
        ct.schema,
        ct.name,
        ct.row_security,
        ct.force_row_security,
        ct.has_indexes,
        ct.has_rules,
        ct.has_triggers,
        ct.has_subclasses,
        ct.is_populated,
        ct.replica_identity,
        ct.is_partition,
        ct.options,
        ct.partition_bound,
        ct.owner,
        coalesce(json_agg(
          case when a.attname is not null then
            json_build_object(
              'name', a.attname,
              'position', a.attnum,
              'data_type', a.atttypid::regtype::text,
              'data_type_str', format_type(a.atttypid, a.atttypmod),
              'is_enum', (e.enum_oid is not null),
              'is_custom_type', (n.nspname not in ('pg_catalog', 'information_schema')),
              'custom_type_schema', case when n.nspname not in ('pg_catalog', 'information_schema') then n.nspname else null end,
              'custom_type_name', case when n.nspname not in ('pg_catalog', 'information_schema') then ty.typname else null end,
              'not_null', a.attnotnull,
              'is_identity', a.attidentity != '',
              'is_identity_always', a.attidentity = 'a',
              'is_generated', a.attgenerated != '',
              'collation', (
                select c2.collname
                from pg_collation c2, pg_type t2
                where c2.oid = a.attcollation
                  and t2.oid = a.atttypid
                  and a.attcollation <> t2.typcollation
              ),
              'default', pg_get_expr(ad.adbin, ad.adrelid),
              'comment', col_description(a.attrelid, a.attnum)
            )
          end
          order by a.attnum
        ) filter (where a.attname is not null), '[]') as columns
      from
        composite_types ct
        left join pg_attribute a on a.attrelid = ct.oid and a.attnum > 0 and not a.attisdropped
        left join pg_attrdef ad on a.attrelid = ad.adrelid and a.attnum = ad.adnum
        left join enums e on a.atttypid = e.enum_oid
        left join pg_type ty on ty.oid = a.atttypid
        left join pg_namespace n on n.oid = ty.typnamespace
      group by
        ct.schema, ct.name, ct.row_security, ct.force_row_security, ct.has_indexes, ct.has_rules, ct.has_triggers, ct.has_subclasses, ct.is_populated, ct.replica_identity, ct.is_partition, ct.options, ct.partition_bound, ct.owner
      order by
        ct.schema, ct.name;
    `;

    return compositeTypeRows.map((ct) => new CompositeType(ct));
  });
}
