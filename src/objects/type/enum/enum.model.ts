import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../../base.model.ts";

const enumLabelSchema = z.object({
  sort_order: z.number(),
  label: z.string(),
});

/**
 * All properties exposed by CREATE TYPE AS ENUM statement are included in diff output.
 * https://www.postgresql.org/docs/current/sql-createtype.html
 *
 * ALTER TYPE statement can be generated for changes to the following properties:
 *  - name, owner, schema, add or rename value
 * https://www.postgresql.org/docs/current/sql-altertype.html
 *
 * Sort order of values may be negative or fractional.
 * https://www.postgresql.org/docs/current/catalog-pg-enum.html
 *
 * Type ACL will be supported separately.
 * https://www.postgresql.org/docs/current/ddl-priv.html
 */
const enumPropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  owner: z.string(),
  labels: z.array(enumLabelSchema),
  comment: z.string().nullable(),
});

export type EnumProps = z.infer<typeof enumPropsSchema>;

export class Enum extends BasePgModel {
  public readonly schema: EnumProps["schema"];
  public readonly name: EnumProps["name"];
  public readonly owner: EnumProps["owner"];
  public readonly labels: EnumProps["labels"];
  public readonly comment: EnumProps["comment"];

  constructor(props: EnumProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.owner = props.owner;
    this.labels = props.labels;
    this.comment = props.comment;
  }

  get stableId(): `enum:${string}` {
    return `enum:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      owner: this.owner,
      labels: this.labels,
      comment: this.comment,
    };
  }
}

export async function extractEnums(sql: Sql): Promise<Enum[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const enumRows = await sql`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_type'::regclass
)
select
  t.typnamespace::regnamespace::text as schema,
  quote_ident(t.typname) as name,
  e.enumsortorder as sort_order,
  e.enumlabel as label,
  t.typowner::regrole::text as owner,
  obj_description(t.oid, 'pg_type') as comment
from
  pg_catalog.pg_enum e
  inner join pg_catalog.pg_type t on t.oid = e.enumtypid
  left outer join extension_oids ext on t.oid = ext.objid
  where not t.typnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and ext.objid is null
order by
  1, 2, 3;
  `;
    const grouped: Record<
      string,
      {
        schema: string;
        name: string;
        owner: string;
        labels: { sort_order: number; label: string }[];
        comment: string | null;
      }
    > = {};
    for (const e of enumRows) {
      const key = `${e.schema}.${e.name}`;
      if (!grouped[key]) {
        grouped[key] = {
          schema: e.schema,
          name: e.name,
          owner: e.owner,
          labels: [],
          comment: e.comment,
        };
      }
      grouped[key].labels.push({ sort_order: e.sort_order, label: e.label });
    }
    // Validate and parse each enum using the Zod schema
    const validatedEnums = Object.values(grouped).map((e) =>
      enumPropsSchema.parse(e),
    );
    return validatedEnums.map((e: EnumProps) => new Enum(e));
  });
}
