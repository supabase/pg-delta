import type { Sql } from "postgres";
import z from "zod";
import {
  BasePgModel,
  columnPropsSchema,
  type TableLikeObject,
} from "../base.model.ts";

export const RelationPersistenceSchema = z.enum([
  "p", // permanent
  "u", // unlogged
  "t", // temporary
]);

export const ReplicaIdentitySchema = z.enum([
  "d", // DEFAULT (use default key)
  "n", // NOTHING (no replica identity)
  "f", // FULL (all columns)
  "i", // INDEX (specific index)
]);

const ForeignKeyActionSchema = z.enum([
  "a", // NO ACTION
  "r", // RESTRICT
  "c", // CASCADE
  "n", // SET NULL
  "d", // SET DEFAULT
]);

const ForeignKeyMatchTypeSchema = z.enum([
  "f", // FULL
  "p", // PARTIAL
  "s", // SIMPLE
  "u", // UNSPECIFIED (default)
]);

export type RelationPersistence = z.infer<typeof RelationPersistenceSchema>;
export type ReplicaIdentity = z.infer<typeof ReplicaIdentitySchema>;

const tableConstraintPropsSchema = z.object({
  name: z.string(),
  constraint_type: z.enum([
    "c", // CHECK constraint
    "f", // FOREIGN KEY constraint
    "p", // PRIMARY KEY constraint
    "u", // UNIQUE constraint
    "x", // EXCLUDE constraint
  ]),
  deferrable: z.boolean(),
  initially_deferred: z.boolean(),
  validated: z.boolean(),
  is_local: z.boolean(),
  no_inherit: z.boolean(),
  key_columns: z.array(z.number()),
  foreign_key_columns: z.array(z.number()).nullable(),
  foreign_key_table: z.string().nullable(),
  foreign_key_schema: z.string().nullable(),
  on_update: ForeignKeyActionSchema.nullable(),
  on_delete: ForeignKeyActionSchema.nullable(),
  match_type: ForeignKeyMatchTypeSchema.nullable(),
  check_expression: z.string().nullable(),
  owner: z.string(),
});

export type TableConstraintProps = z.infer<typeof tableConstraintPropsSchema>;

const tablePropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  persistence: RelationPersistenceSchema,
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
  parent_schema: z.string().nullable(),
  parent_name: z.string().nullable(),
  columns: z.array(columnPropsSchema),
  constraints: z.array(tableConstraintPropsSchema).optional(),
});

export type TableProps = z.infer<typeof tablePropsSchema>;

export class Table extends BasePgModel implements TableLikeObject {
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
  public readonly columns: TableProps["columns"];
  public readonly constraints: TableConstraintProps[];

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
    this.columns = props.columns;
    this.constraints = props.constraints ?? [];
  }

  get stableId(): `table:${string}` {
    return `table:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      // Only include fields that can be managed via ALTER safely
      persistence: this.persistence,
      row_security: this.row_security,
      force_row_security: this.force_row_security,
      replica_identity: this.replica_identity,
      options: this.options,
      owner: this.owner,
      columns: this.columns,
      constraints: this.constraints,
    };
  }
}

export async function extractTables(sql: Sql): Promise<Table[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const tableRows = await sql`
with extension_oids as (
  select objid
  from pg_depend d
  where d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
), tables as (
  select
    c.relnamespace::regnamespace::text as schema,
    quote_ident(c.relname) as name,
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
    c.relowner::regrole::text as owner,
    c_parent.relnamespace::regnamespace as parent_schema,
    c_parent.relname as parent_name,
    c.oid as oid
  from
    pg_class c
    left join extension_oids e1 on c.oid = e1.objid
    left join pg_inherits i on i.inhrelid = c.oid
    left join pg_class c_parent on i.inhparent = c_parent.oid
  where
    c.relkind in ('r', 'p')
    and not c.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
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
  t.parent_name,
  coalesce(
    (
      select json_agg(
        json_build_object(
          'name', quote_ident(c.conname),
          'constraint_type', c.contype,
          'deferrable', c.condeferrable,
          'initially_deferred', c.condeferred,
          'validated', c.convalidated,
          'is_local', c.conislocal,
          'no_inherit', c.connoinherit,
          'key_columns', c.conkey,
          'foreign_key_columns', c.confkey,
          'foreign_key_table', ftc.relname,
          'foreign_key_schema', ftc.relnamespace::regnamespace::text,
          'on_update', case when c.contype = 'f' then c.confupdtype else null end,
          'on_delete', case when c.contype = 'f' then c.confdeltype else null end,
          'match_type', case when c.contype = 'f' then c.confmatchtype else null end,
          'check_expression', pg_get_expr(c.conbin, c.conrelid),
          'owner', t.owner
        )
        order by c.conname
      )
      from pg_catalog.pg_constraint c
      left join pg_catalog.pg_class ftc on ftc.oid = c.confrelid
      left join pg_depend de on de.classid = 'pg_constraint'::regclass and de.objid = c.oid and de.refclassid = 'pg_extension'::regclass
      where c.conrelid = t.oid
        and not c.connamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
        and de.objid is null
    ), '[]'
  ) as constraints,
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
        'custom_type_name', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then ty.typname else null end,
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
  tables t
  left join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  left join pg_type ty on ty.oid = a.atttypid
group by
  t.oid, t.schema, t.name, t.persistence, t.row_security, t.force_row_security, t.has_indexes, t.has_rules, t.has_triggers, t.has_subclasses, t.is_populated, t.replica_identity, t.is_partition, t.options, t.partition_bound, t.owner, t.parent_schema, t.parent_name
order by
  t.schema, t.name;
    `;
    // Validate and parse each row using the Zod schema
    const validatedRows = tableRows.map((row: unknown) =>
      tablePropsSchema.parse(row),
    );
    return validatedRows.map((row: TableProps) => new Table(row));
  });
}
