import type { Sql } from "postgres";
import { BasePgModel } from "../base.model.ts";

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
export interface IndexProps {
  table_schema: string;
  table_name: string;
  name: string;
  storage_params: string[];
  statistics_target: number[];
  index_type: string;
  tablespace: string | null;
  is_unique: boolean;
  is_primary: boolean;
  is_exclusion: boolean;
  nulls_not_distinct: boolean;
  immediate: boolean;
  is_clustered: boolean;
  is_replica_identity: boolean;
  key_columns: number[];
  column_collations: string[];
  operator_classes: string[];
  column_options: number[];
  index_expressions: string | null;
  partial_predicate: string | null;
  table_relkind: string; // 'r' for table, 'm' for materialized view
}

export class Index extends BasePgModel {
  public readonly table_schema: IndexProps["table_schema"];
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

  constructor(props: IndexProps) {
    super();

    // Identity fields
    this.table_schema = props.table_schema;
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
  }

  get stableId(): `index:${string}` {
    return `index:${this.table_schema}.${this.table_name}.${this.name}`;
  }

  get tableStableId(): `table:${string}` {
    return `table:${this.table_schema}.${this.table_name}`;
  }

  get identityFields() {
    return {
      table_schema: this.table_schema,
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
    };
  }
}

export async function extractIndexes(sql: Sql): Promise<Index[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const indexRows = await sql<IndexProps[]>`
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
  tc.relnamespace::regnamespace as table_schema,
  tc.relname as table_name,
  tc.relkind as table_relkind,
  c.relname as name,
  coalesce(c.reloptions, array[]::text[]) as storage_params,
  am.amname as index_type,
  ts.spcname as tablespace,
  i.indisunique as is_unique,
  i.indisprimary as is_primary,
  i.indisexclusion as is_exclusion,
  i.indnullsnotdistinct as nulls_not_distinct,
  i.indimmediate as immediate,
  i.indisclustered as is_clustered,
  i.indisreplident as is_replica_identity,
  i.indkey as key_columns,
  i.indcollation::regcollation[] as column_collations,
  array(
    select coalesce(attstattarget, -1)
    from pg_catalog.pg_attribute a
    where a.attrelid = i.indexrelid
  ) as statistics_target,
  array(
    select format('%I.%I', opcnamespace::regnamespace, opcname)
    from unnest(i.indclass) op
    left join pg_opclass oc on oc.oid = op
  ) as operator_classes,
  i.indoption as column_options,
  pg_get_expr(i.indexprs, i.indrelid) as index_expressions,
  pg_get_expr(i.indpred, i.indrelid) as partial_predicate
from
  pg_catalog.pg_index i
  inner join pg_catalog.pg_class tc on tc.oid = i.indrelid
  inner join pg_catalog.pg_class c on c.oid = i.indexrelid
  inner join pg_catalog.pg_am am on am.oid = c.relam
  left join pg_catalog.pg_tablespace ts on ts.oid = c.reltablespace
  left outer join extension_oids e on c.oid = e.objid
  where not c.relnamespace::regnamespace::text like any(array['pg\_%', 'information\_schema'])
  and i.indislive is true
  and e.objid is null
order by
  1, 2;
    `;
    return indexRows.map((row) => new Index(row));
  });
}
