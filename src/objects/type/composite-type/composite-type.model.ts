import type { Sql } from "postgres";
import z from "zod";
import {
  BasePgModel,
  columnPropsSchema,
  type TableLikeObject,
} from "../../base.model.ts";
import { ReplicaIdentitySchema } from "../../table/table.model.ts";

const compositeTypePropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  row_security: z.boolean(),
  force_row_security: z.boolean(),
  has_indexes: z.boolean(),
  has_rules: z.boolean(),
  has_triggers: z.boolean(),
  has_subclasses: z.boolean(),
  is_populated: z.boolean(),
  replica_identity: ReplicaIdentitySchema,
  is_partition: z.boolean(),
  options: z.array(z.string()).nullable(),
  partition_bound: z.string().nullable(),
  owner: z.string(),
  columns: z.array(columnPropsSchema),
});

export type CompositeTypeProps = z.infer<typeof compositeTypePropsSchema>;

export class CompositeType extends BasePgModel implements TableLikeObject {
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
  public readonly columns: CompositeTypeProps["columns"];

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
    this.columns = props.columns;
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
      columns: this.columns,
    };
  }
}

export async function extractCompositeTypes(
  sql: Sql,
): Promise<CompositeType[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;

    const compositeTypeRows = await sql`
      with extension_oids as (
        select
          objid
        from
          pg_depend d
        where
          d.refclassid = 'pg_extension'::regclass
          and d.classid = 'pg_class'::regclass
      ), composite_types as (
        select
          c.relnamespace::regnamespace::text as schema,
          quote_ident(c.relname) as name,
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
          c.relowner::regrole::text as owner,
          c.oid as oid
        from
          pg_catalog.pg_class c
          left outer join extension_oids e on c.oid = e.objid
        where not c.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
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
              'name', quote_ident(a.attname),
              'position', a.attnum,
              'data_type', a.atttypid::regtype::text,
              'data_type_str', format_type(a.atttypid, a.atttypmod),
              'is_custom_type', ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema'),
              'custom_type_type', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then ty.typtype else null end,
              'custom_type_category', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then ty.typcategory else null end,
              'custom_type_schema', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then ty.typnamespace::regnamespace else null end,
              'custom_type_name', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then quote_ident(ty.typname) else null end,
              'not_null', a.attnotnull,
              'is_identity', a.attidentity != '',
              'is_identity_always', a.attidentity = 'a',
              'is_generated', a.attgenerated != '',
              'collation', (
                select quote_ident(c2.collname)
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
        left join pg_type ty on ty.oid = a.atttypid
        -- use regnamespace instead of joining pg_namespace
        
      group by
        ct.schema, ct.name, ct.row_security, ct.force_row_security, ct.has_indexes, ct.has_rules, ct.has_triggers, ct.has_subclasses, ct.is_populated, ct.replica_identity, ct.is_partition, ct.options, ct.partition_bound, ct.owner, ct.oid
      order by
        ct.schema, ct.name;
    `;

    // Validate and parse each row using the Zod schema
    const validatedRows = compositeTypeRows.map((row: unknown) =>
      compositeTypePropsSchema.parse(row),
    );
    return validatedRows.map(
      (row: CompositeTypeProps) => new CompositeType(row),
    );
  });
}
