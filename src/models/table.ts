import type { Sql } from "postgres";
import { BasePgModel } from "./base.ts";

export type RelationPersistence = "p" | "u" | "t";
export type ReplicaIdentity = "d" | "n" | "f" | "i";

interface TableProps {
  schema: string;
  name: string;
  persistence: RelationPersistence;
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
  parent_schema: string | null;
  parent_name: string | null;
}

export class Table extends BasePgModel {
  public readonly schema: TableProps["schema"];
  public readonly name: TableProps["name"];
  public readonly persistence: TableProps["persistence"];
  public readonly row_security: TableProps["row_security"];
  public readonly force_row_security: TableProps["force_row_security"];
  public readonly has_indexes: TableProps["has_indexes"];
  public readonly has_rules: TableProps["has_rules"];
  public readonly has_triggers: TableProps["has_triggers"];
  public readonly has_subclasses: TableProps["has_subclasses"];
  public readonly is_populated: TableProps["is_populated"];
  public readonly replica_identity: TableProps["replica_identity"];
  public readonly is_partition: TableProps["is_partition"];
  public readonly options: TableProps["options"];
  public readonly partition_bound: TableProps["partition_bound"];
  public readonly owner: TableProps["owner"];
  public readonly parent_schema: TableProps["parent_schema"];
  public readonly parent_name: TableProps["parent_name"];

  constructor(props: TableProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.persistence = props.persistence;
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
    this.parent_schema = props.parent_schema;
    this.parent_name = props.parent_name;
  }

  get stableId() {
    return `${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      persistence: this.persistence,
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
      parent_schema: this.parent_schema,
      parent_name: this.parent_name,
    };
  }
}

export async function extractTables(sql: Sql): Promise<Table[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const tableRows = await sql<TableProps[]>`
with extension_oids as (
  select objid
  from pg_depend d
  where d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
), tables as (
  select
    n.nspname as schema,
    c.relname as name,
    c.relpersistence as persistence,
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
    n_parent.nspname as parent_schema,
    c_parent.relname as parent_name,
    c.oid as oid
  from
    pg_class c
    inner join pg_namespace n on n.oid = c.relnamespace
    left join extension_oids e1 on c.oid = e1.objid
    left join pg_inherits i on i.inhrelid = c.oid
    left join pg_class c_parent on i.inhparent = c_parent.oid
    left join pg_namespace n_parent on c_parent.relnamespace = n_parent.oid
  where
    c.relkind in ('r', 'p')
    and n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
    and n.nspname not like 'pg\_temp\_%'
    and n.nspname not like 'pg\_toast\_temp\_%'
    and e1.objid is null
)
select
  t.schema,
  t.name,
  t.persistence,
  t.row_security,
  t.force_row_security,
  t.has_indexes,
  t.has_rules,
  t.has_triggers,
  t.has_subclasses,
  t.is_populated,
  t.replica_identity,
  t.is_partition,
  t.options,
  t.partition_bound,
  t.owner,
  t.parent_schema,
  t.parent_name
from
  tables t
order by
  t.schema, t.name;
    `;
    return tableRows.map((row) => new Table(row));
  });
}
