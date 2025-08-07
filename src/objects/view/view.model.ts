import type { Sql } from "postgres";
import { BasePgModel } from "../base.model.ts";

export type ReplicaIdentity = "d" | "n" | "f" | "i";

export interface ViewProps {
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

export class View extends BasePgModel {
  public readonly schema: ViewProps["schema"];
  public readonly name: ViewProps["name"];
  public readonly definition: ViewProps["definition"];
  public readonly row_security: ViewProps["row_security"];
  public readonly force_row_security: ViewProps["force_row_security"];
  public readonly has_indexes: ViewProps["has_indexes"];
  public readonly has_rules: ViewProps["has_rules"];
  public readonly has_triggers: ViewProps["has_triggers"];
  public readonly has_subclasses: ViewProps["has_subclasses"];
  public readonly is_populated: ViewProps["is_populated"];
  public readonly replica_identity: ViewProps["replica_identity"];
  public readonly is_partition: ViewProps["is_partition"];
  public readonly options: ViewProps["options"];
  public readonly partition_bound: ViewProps["partition_bound"];
  public readonly owner: ViewProps["owner"];

  constructor(props: ViewProps) {
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

  get stableId(): `view:${string}` {
    return `view:${this.schema}.${this.name}`;
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

export async function extractViews(sql: Sql): Promise<View[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const viewRows = await sql<ViewProps[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
), views as (
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
    and c.relkind = 'v'
)
select
  v.schema,
  v.name,
  v.definition,
  v.row_security,
  v.force_row_security,
  v.has_indexes,
  v.has_rules,
  v.has_triggers,
  v.has_subclasses,
  v.is_populated,
  v.replica_identity,
  v.is_partition,
  v.options,
  v.partition_bound,
  v.owner
from
  views v
order by
  v.schema, v.name;
    `;
    return viewRows.map((row) => new View(row));
  });
}
