import type { Sql } from "postgres";
import { BasePgModel } from "./base.ts";
import type { ReplicaIdentity } from "./table.ts";

interface MaterializedViewProps {
  schema: string;
  name: string;
  definition: string | null;
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

export class MaterializedView extends BasePgModel {
  public readonly schema: MaterializedViewProps["schema"];
  public readonly name: MaterializedViewProps["name"];
  public readonly definition: MaterializedViewProps["definition"];
  public readonly row_security: MaterializedViewProps["row_security"];
  public readonly force_row_security: MaterializedViewProps["force_row_security"];
  public readonly has_indexes: MaterializedViewProps["has_indexes"];
  public readonly has_rules: MaterializedViewProps["has_rules"];
  public readonly has_triggers: MaterializedViewProps["has_triggers"];
  public readonly has_subclasses: MaterializedViewProps["has_subclasses"];
  public readonly is_populated: MaterializedViewProps["is_populated"];
  public readonly replica_identity: MaterializedViewProps["replica_identity"];
  public readonly is_partition: MaterializedViewProps["is_partition"];
  public readonly options: MaterializedViewProps["options"];
  public readonly partition_bound: MaterializedViewProps["partition_bound"];
  public readonly owner: MaterializedViewProps["owner"];

  constructor(props: MaterializedViewProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.definition = props.definition;
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

  get stableId(): `materializedView:${string}` {
    return `materializedView:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      definition: this.definition,
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

export async function extractMaterializedViews(
  sql: Sql,
): Promise<MaterializedView[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const mvRows = await sql<MaterializedViewProps[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
), materialized_views as (
  select
    n.nspname as schema,
    c.relname as name,
    pg_get_viewdef(c.oid) as definition,
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
    and c.relkind = 'm'
)
select
  mv.schema,
  mv.name,
  mv.definition,
  mv.row_security,
  mv.force_row_security,
  mv.has_indexes,
  mv.has_rules,
  mv.has_triggers,
  mv.has_subclasses,
  mv.is_populated,
  mv.replica_identity,
  mv.is_partition,
  mv.options,
  mv.partition_bound,
  mv.owner
from
  materialized_views mv
order by
  mv.schema, mv.name;
    `;
    return mvRows.map((row) => new MaterializedView(row));
  });
}
