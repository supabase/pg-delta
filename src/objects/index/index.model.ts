import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const TableRelkindSchema = z.enum([
  "r", // table (regular relation)
  "m", // materialized view
  "p", // partitioned table
]);

const indexPropsSchema = z.object({
  schema: z.string(),
  table_name: z.string(),
  name: z.string(),
  storage_params: z.array(z.string()),
  statistics_target: z.array(z.number()),
  index_type: z.string(),
  tablespace: z.string().nullable(),
  is_unique: z.boolean(),
  is_primary: z.boolean(),
  is_exclusion: z.boolean(),
  nulls_not_distinct: z.boolean(),
  immediate: z.boolean(),
  is_clustered: z.boolean(),
  is_replica_identity: z.boolean(),
  key_columns: z.array(z.number()),
  column_collations: z.array(z.string()),
  operator_classes: z.array(z.string()),
  column_options: z.array(z.number()),
  index_expressions: z.string().nullable(),
  partial_predicate: z.string().nullable(),
  is_constraint: z.boolean(),
  table_relkind: TableRelkindSchema, // 'r' for table, 'm' for materialized view
  definition: z.string(),
  comment: z.string().nullable(),
});

/**
 * All properties exposed by CREATE INDEX statement are included in diff output.
 * https://www.postgresql.org/docs/current/sql-createindex.html
 *
 * ALTER INDEX statement can only be generated for a subset of properties:
 *  - name, storage param, statistics, tablespace, attach partition
 * https://www.postgresql.org/docs/current/sql-alterindex.html
 *
 * Unsupported alter properties include
 *  - depends on extension (all extension dependencies are excluded)
 *
 * Other properties require dropping and creating a new index.
 */
export type IndexProps = z.infer<typeof indexPropsSchema>;

export class Index extends BasePgModel {
  public readonly schema: IndexProps["schema"];
  public readonly table_name: IndexProps["table_name"];
  public readonly name: IndexProps["name"];
  public readonly storage_params: IndexProps["storage_params"];
  public readonly statistics_target: IndexProps["statistics_target"];
  public readonly index_type: IndexProps["index_type"];
  public readonly tablespace: IndexProps["tablespace"];
  public readonly is_unique: IndexProps["is_unique"];
  public readonly is_primary: IndexProps["is_primary"];
  public readonly is_exclusion: IndexProps["is_exclusion"];
  public readonly nulls_not_distinct: IndexProps["nulls_not_distinct"];
  public readonly immediate: IndexProps["immediate"];
  public readonly is_clustered: IndexProps["is_clustered"];
  public readonly is_replica_identity: IndexProps["is_replica_identity"];
  public readonly key_columns: IndexProps["key_columns"];
  public readonly column_collations: IndexProps["column_collations"];
  public readonly operator_classes: IndexProps["operator_classes"];
  public readonly column_options: IndexProps["column_options"];
  public readonly index_expressions: IndexProps["index_expressions"];
  public readonly partial_predicate: IndexProps["partial_predicate"];
  public readonly table_relkind: IndexProps["table_relkind"];
  public readonly is_constraint: IndexProps["is_constraint"];
  public readonly definition: IndexProps["definition"];
  public readonly comment: IndexProps["comment"];

  constructor(props: IndexProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.table_name = props.table_name;
    this.name = props.name;

    // Data fields
    this.storage_params = props.storage_params;
    this.statistics_target = props.statistics_target;
    this.index_type = props.index_type;
    this.tablespace = props.tablespace;
    this.is_unique = props.is_unique;
    this.is_primary = props.is_primary;
    this.is_exclusion = props.is_exclusion;
    this.nulls_not_distinct = props.nulls_not_distinct;
    this.immediate = props.immediate;
    this.is_clustered = props.is_clustered;
    this.is_replica_identity = props.is_replica_identity;
    this.key_columns = props.key_columns;
    this.column_collations = props.column_collations;
    this.operator_classes = props.operator_classes;
    this.column_options = props.column_options;
    this.index_expressions = props.index_expressions;
    this.partial_predicate = props.partial_predicate;
    this.table_relkind = props.table_relkind;
    this.is_constraint = props.is_constraint;
    this.definition = props.definition;
    this.comment = props.comment;
  }

  get stableId(): `index:${string}` {
    return `index:${this.schema}.${this.table_name}.${this.name}`;
  }

  get tableStableId(): `table:${string}` {
    return `table:${this.schema}.${this.table_name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      table_name: this.table_name,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      storage_params: this.storage_params,
      statistics_target: this.statistics_target,
      index_type: this.index_type,
      tablespace: this.tablespace,
      is_unique: this.is_unique,
      is_primary: this.is_primary,
      is_exclusion: this.is_exclusion,
      nulls_not_distinct: this.nulls_not_distinct,
      immediate: this.immediate,
      is_clustered: this.is_clustered,
      is_replica_identity: this.is_replica_identity,
      key_columns: this.key_columns,
      column_collations: this.column_collations,
      operator_classes: this.operator_classes,
      column_options: this.column_options,
      index_expressions: this.index_expressions,
      partial_predicate: this.partial_predicate,
      table_relkind: this.table_relkind,
      is_constraint: this.is_constraint,
      definition: this.definition,
      comment: this.comment,
    };
  }
}

export async function extractIndexes(sql: Sql): Promise<Index[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const indexRows = await sql`
    with extension_oids as (
      select objid
      from pg_depend d
      where d.refclassid = 'pg_extension'::regclass
        and d.classid   = 'pg_class'::regclass
    ),
    -- align every per-column array by ordinality (1..indnatts)
    -- this is used to ensure that key_columns, column_collations, operator_classes, and column_options are aligned
    idx_cols as (
      select
        i.indexrelid,
        i.indrelid,
        k.ord,
        k.attnum,
        -- collation: only for key cols; 0 for none/default
        case when k.ord <= i.indnkeyatts then coalesce(coll.oid, 0) else 0 end as coll_oid,
        -- opclass: one per column
        coalesce(cls.oid, 0) as cls_oid,
        -- options: only for key cols; 0 for include cols
        case when k.ord <= i.indnkeyatts then coalesce(opt.val, 0) else 0 end::int2 as indopt
      from pg_index i
      join lateral unnest(i.indkey)      with ordinality as k(attnum, ord) on true
      left join lateral unnest(i.indcollation) with ordinality as coll(oid, ordc) on ordc = k.ord
      left join lateral unnest(i.indclass)     with ordinality as cls(oid, ordo) on ordo = k.ord
      left join lateral unnest(i.indoption)    with ordinality as opt(val, ordi) on ordi = k.ord
    )
    select
      quote_ident(n.nspname)                        as schema,
      quote_ident(tc.relname)          as table_name,
      tc.relkind                       as table_relkind,
      quote_ident(c.relname)           as name,
      coalesce(c.reloptions, array[]::text[]) as storage_params,
      am.amname                        as index_type,
      quote_ident(ts.spcname)          as tablespace,
      i.indisunique                    as is_unique,
      i.indisprimary                   as is_primary,
      i.indisexclusion                 as is_exclusion,
      i.indnullsnotdistinct            as nulls_not_distinct,
      i.indimmediate                   as immediate,
      i.indisclustered                 as is_clustered,
      i.indisreplident                 as is_replica_identity,
      i.indkey                         as key_columns,

      exists (select 1 from pg_constraint pc where pc.conindid = i.indexrelid) as is_constraint,

      -- per-column arrays from one pass over idx_cols
      coalesce(agg.column_collations, array[]::text[]) as column_collations,
      coalesce(agg.operator_classes, array[]::text[])  as operator_classes,
      coalesce(agg.column_options,   array[]::int2[])  as column_options,

      -- always an array (possibly empty), ordered by index attnum
      coalesce(st.statistics_target, array[]::int4[])  as statistics_target,

      pg_get_expr(i.indexprs, i.indrelid) as index_expressions,
      pg_get_expr(i.indpred,  i.indrelid) as partial_predicate,
      pg_get_indexdef(i.indexrelid, 0, true) as definition
      , obj_description(c.oid, 'pg_class') as comment

    from pg_index i
    join pg_class c  on c.oid  = i.indexrelid
    join pg_class tc on tc.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_am am    on am.oid = c.relam
    left join pg_tablespace ts on ts.oid = c.reltablespace
    left join extension_oids e  on c.oid = e.objid
    left join extension_oids e_table on tc.oid = e_table.objid

    -- single lateral aggregate keeps order by ic2.ord
    left join lateral (
      select
        array_agg(
          case
            when ic2.coll_oid = 0 then null
            when col.collname = 'default'
            and col.collnamespace = 'pg_catalog'::regnamespace then null
            else quote_ident(ns_coll.nspname) || '.' || quote_ident(col.collname)
          end
          order by ic2.ord
        ) as column_collations,

        -- 'default' when the AM's default opclass applies to the column's base type
        array_agg(
          case
            when oc.oid is null then 'default'
            when ic2.attnum = 0 then oc.opcnamespace::regnamespace::text || '.' || quote_ident(oc.opcname) -- expression key: no column type
            -- in the case where the opclass is the default for the column's base type
            when oc.opcdefault and (
                  (case when t.typtype = 'd' then t.typbasetype else a.atttypid end) = oc.opcintype
                  or exists (
                    select 1
                    from pg_catalog.pg_cast pc
                    where pc.castsource = (case when t.typtype = 'd' then t.typbasetype else a.atttypid end)
                      and pc.casttarget = oc.opcintype
                      and pc.castcontext = 'i'  -- implicit
                  )
                )
              then 'default'
            else oc.opcnamespace::regnamespace::text || '.' || quote_ident(oc.opcname)
          end
          order by ic2.ord
        ) as operator_classes,

        array_agg(coalesce(ic2.indopt, 0)::int2 order by ic2.ord) as column_options

      from idx_cols ic2
      left join pg_collation  col     on col.oid = ic2.coll_oid
      left join pg_namespace  ns_coll on ns_coll.oid = col.collnamespace
      left join pg_opclass    oc      on oc.oid = ic2.cls_oid
      -- base type for the underlying column (domain -> base); NULL for expressions
      left join pg_attribute  a       on a.attrelid = ic2.indrelid and a.attnum = ic2.attnum
      left join pg_type       t       on t.oid = a.atttypid
      where ic2.indexrelid = i.indexrelid
    ) as agg on true

    left join lateral (
      select array_agg(coalesce(a2.attstattarget, -1) order by a2.attnum) as statistics_target
      from pg_attribute a2
      where a2.attrelid = i.indexrelid
        and a2.attnum > 0
    ) as st on true

    where n.nspname not like 'pg\_%'
      and n.nspname <> 'information_schema'
      and i.indislive is true
      and e.objid is null
      and e_table.objid is null

    order by 1, 2;
    `;
    // Validate and parse each row using the Zod schema
    const validatedRows = indexRows.map((row: unknown) =>
      indexPropsSchema.parse(row),
    );
    return validatedRows.map((row: IndexProps) => new Index(row));
  });
}
