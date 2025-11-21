import type { Sql } from "postgres";
import z from "zod";
import {
  BasePgModel,
  columnPropsSchema,
  type TableLikeObject,
} from "../../base.model.ts";
import {
  type PrivilegeProps,
  privilegePropsSchema,
} from "../../base.privilege-diff.ts";
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
  comment: z.string().nullable(),
  columns: z.array(columnPropsSchema),
  privileges: z.array(privilegePropsSchema),
});

type CompositeTypePrivilegeProps = PrivilegeProps;
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
  public readonly comment: CompositeTypeProps["comment"];
  public readonly columns: CompositeTypeProps["columns"];
  public readonly privileges: CompositeTypePrivilegeProps[];

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
    this.comment = props.comment;
    this.columns = props.columns;
    this.privileges = props.privileges;
  }

  get stableId(): `type:${string}` {
    return `type:${this.schema}.${this.name}`;
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
      comment: this.comment,
      columns: this.columns,
      privileges: this.privileges,
    };
  }
}

export async function extractCompositeTypes(
  sql: Sql,
): Promise<CompositeType[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;

    const compositeTypeRows = await sql`
      WITH extension_oids AS (
        SELECT objid
        FROM pg_depend d
        WHERE d.refclassid = 'pg_extension'::regclass
          AND d.classid    = 'pg_type'::regclass
      ),
      composite_types AS (
        SELECT
          c.relnamespace::regnamespace::text AS schema,
          quote_ident(c.relname)              AS name,
          c.relrowsecurity                    AS row_security,
          c.relforcerowsecurity               AS force_row_security,
          c.relhasindex                       AS has_indexes,
          c.relhasrules                       AS has_rules,
          c.relhastriggers                    AS has_triggers,
          c.relhassubclass                    AS has_subclasses,
          c.relispopulated                    AS is_populated,
          c.relreplident                      AS replica_identity,
          c.relispartition                    AS is_partition,
          c.reloptions                        AS options,
          pg_get_expr(c.relpartbound, c.oid)  AS partition_bound,
          c.relowner::regrole::text           AS owner,
          obj_description(c.reltype, 'pg_type') AS comment,
          c.relacl                            AS relacl,    -- used by privileges LATERAL
          c.oid                                AS oid
        FROM pg_catalog.pg_class c
        LEFT JOIN extension_oids e ON c.reltype = e.objid
        WHERE NOT c.relnamespace::regnamespace::text LIKE ANY (ARRAY['pg\\_%', 'information\\_schema'])
          AND e.objid IS NULL
          AND c.relkind = 'c'
      )
      SELECT
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
        ct.comment,
        COALESCE(priv.privileges, '[]') AS privileges,
        COALESCE(cols.columns, '[]')    AS columns
      FROM composite_types ct

      -- privileges as a per-row LATERAL subquery
      LEFT JOIN LATERAL (
        SELECT json_agg(
                json_build_object(
                  'grantee',   CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END,
                  'privilege', x.privilege_type,
                  'grantable', x.is_grantable
                )
                ORDER BY x.grantee, x.privilege_type
              ) AS privileges
        FROM LATERAL aclexplode(ct.relacl) AS x(grantor, grantee, privilege_type, is_grantable)
      ) priv ON TRUE

      -- columns as a per-row LATERAL subquery (so no GROUP BY needed)
      LEFT JOIN LATERAL (
        SELECT json_agg(
                json_build_object(
                  'name',                 quote_ident(a.attname),
                  'position',             a.attnum,
                  'data_type',            a.atttypid::regtype::text,
                  'data_type_str',        format_type(a.atttypid, a.atttypmod),
                  'is_custom_type',       ty.typnamespace::regnamespace::text NOT IN ('pg_catalog','information_schema'),
                  'custom_type_type',     CASE WHEN ty.typnamespace::regnamespace::text NOT IN ('pg_catalog','information_schema') THEN ty.typtype    ELSE NULL END,
                  'custom_type_category', CASE WHEN ty.typnamespace::regnamespace::text NOT IN ('pg_catalog','information_schema') THEN ty.typcategory ELSE NULL END,
                  'custom_type_schema',   CASE WHEN ty.typnamespace::regnamespace::text NOT IN ('pg_catalog','information_schema') THEN ty.typnamespace::regnamespace ELSE NULL END,
                  'custom_type_name',     CASE WHEN ty.typnamespace::regnamespace::text NOT IN ('pg_catalog','information_schema') THEN quote_ident(ty.typname) ELSE NULL END,
                  'not_null',             a.attnotnull,
                  'is_identity',          a.attidentity <> '',
                  'is_identity_always',   a.attidentity = 'a',
                  'is_generated',         a.attgenerated <> '',
                  'collation', (
                    SELECT quote_ident(c2.collname)
                    FROM pg_collation c2, pg_type t2
                    WHERE c2.oid = a.attcollation
                      AND t2.oid = a.atttypid
                      AND a.attcollation <> t2.typcollation
                  ),
                  'default',              pg_get_expr(ad.adbin, ad.adrelid),
                  'comment',              col_description(a.attrelid, a.attnum)
                )
                ORDER BY a.attnum
              ) AS columns
        FROM pg_attribute a
        LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
        LEFT JOIN pg_type    ty ON ty.oid     = a.atttypid
        WHERE a.attrelid = ct.oid
          AND a.attnum > 0
          AND NOT a.attisdropped
      ) cols ON TRUE

      ORDER BY ct.schema, ct.name;
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
