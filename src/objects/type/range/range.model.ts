import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../../base.model.ts";

const rangePropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  owner: z.string(),
  comment: z.string().nullable(),

  // Subtype information
  subtype_schema: z.string(),
  subtype_str: z.string(),

  // Optional, only present when non-default relative to subtype
  collation: z.string().nullable(),

  // Canonical and diff functions when present (non-default)
  canonical_function_schema: z.string().nullable(),
  canonical_function_name: z.string().nullable(),
  subtype_diff_schema: z.string().nullable(),
  subtype_diff_name: z.string().nullable(),

  // Optional: print only when non-default (see extractor logic)
  subtype_opclass_schema: z.string().nullable(),
  subtype_opclass_name: z.string().nullable(),
});

export type RangeProps = z.infer<typeof rangePropsSchema>;

export class Range extends BasePgModel {
  public readonly schema: RangeProps["schema"];
  public readonly name: RangeProps["name"];
  public readonly owner: RangeProps["owner"];
  public readonly comment: RangeProps["comment"];

  public readonly subtype_schema: RangeProps["subtype_schema"];
  public readonly subtype_str: RangeProps["subtype_str"];

  public readonly collation: RangeProps["collation"];

  public readonly canonical_function_schema: RangeProps["canonical_function_schema"];
  public readonly canonical_function_name: RangeProps["canonical_function_name"];
  public readonly subtype_diff_schema: RangeProps["subtype_diff_schema"];
  public readonly subtype_diff_name: RangeProps["subtype_diff_name"];

  public readonly subtype_opclass_schema: RangeProps["subtype_opclass_schema"];
  public readonly subtype_opclass_name: RangeProps["subtype_opclass_name"];

  constructor(props: RangeProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.owner = props.owner;
    this.comment = props.comment;
    this.subtype_schema = props.subtype_schema;
    this.subtype_str = props.subtype_str;
    this.collation = props.collation;
    this.canonical_function_schema = props.canonical_function_schema;
    this.canonical_function_name = props.canonical_function_name;
    this.subtype_diff_schema = props.subtype_diff_schema;
    this.subtype_diff_name = props.subtype_diff_name;
    this.subtype_opclass_schema = props.subtype_opclass_schema;
    this.subtype_opclass_name = props.subtype_opclass_name;
  }

  get stableId(): `range:${string}` {
    return `range:${this.schema}.${this.name}`;
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
      subtype_schema: this.subtype_schema,
      subtype_str: this.subtype_str,
      collation: this.collation,
      canonical_function_schema: this.canonical_function_schema,
      canonical_function_name: this.canonical_function_name,
      subtype_diff_schema: this.subtype_diff_schema,
      subtype_diff_name: this.subtype_diff_name,
      subtype_opclass_schema: this.subtype_opclass_schema,
      subtype_opclass_name: this.subtype_opclass_name,
      comment: this.comment,
    };
  }
}

/**
 * Extract all range types from the database.
 *
 * We intentionally capture only non-default options for CREATE TYPE AS RANGE:
 *  - SUBTYPE is required and always present
 *  - SUBTYPE_OPCLASS is included only when it differs from the default btree opclass
 *  - COLLATION is included only when it differs from the subtype's typcollation
 *  - CANONICAL and SUBTYPE_DIFF are included only when set
 *  - MULTIRANGE_TYPE_NAME is not included (we currently do not attempt to infer
 *    whether it differs from the default auto-generated name)
 */
export async function extractRanges(sql: Sql): Promise<Range[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const rows = await sql`
with extension_oids as (
  select objid from pg_depend d
  where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_type'::regclass
), default_btree_opclass as (
  -- For each input type, find its default btree operator class
  select oc2.opcintype as type_oid, oc2.oid as opclass_oid
  from pg_opclass oc2
  join pg_am am on am.oid = oc2.opcmethod and am.amname = 'btree'
  where oc2.opcdefault
)
select
  -- range type identity
  t.typnamespace::regnamespace::text as schema,
  quote_ident(t.typname) as name,
  t.typowner::regrole::text as owner,
  obj_description(t.oid, 'pg_type') as comment,

  -- subtype info
  subt.typnamespace::regnamespace::text as subtype_schema,
  format_type(r.rngsubtype, 0) as subtype_str,

  -- include collation only if not default
  case when r.rngcollation is not null and r.rngcollation <> 0 and r.rngcollation <> subt.typcollation then quote_ident(c.collname) else null end as collation,

  -- include canonical/subtype_diff when set
  case when r.rngcanonical <> 0 then pn_subcanon.nspname::regnamespace::text else null end as canonical_function_schema,
  case when r.rngcanonical <> 0 then quote_ident(p_subcanon.proname) else null end as canonical_function_name,
  case when r.rngsubdiff <> 0 then pn_subdiff.nspname::regnamespace::text else null end as subtype_diff_schema,
  case when r.rngsubdiff <> 0 then quote_ident(p_subdiff.proname) else null end as subtype_diff_name,

  -- include opclass only when not default for btree
  case when r.rngsubopc is not null and r.rngsubopc <> 0 and r.rngsubopc <> dbo.opclass_oid then opc.opcnamespace::regnamespace::text else null end as subtype_opclass_schema,
  case when r.rngsubopc is not null and r.rngsubopc <> 0 and r.rngsubopc <> dbo.opclass_oid then quote_ident(opc.opcname) else null end as subtype_opclass_name
from pg_catalog.pg_range r
join pg_catalog.pg_type t on t.oid = r.rngtypid
join pg_catalog.pg_type subt on subt.oid = r.rngsubtype
left join default_btree_opclass dbo on dbo.type_oid = r.rngsubtype
left join pg_catalog.pg_opclass opc on opc.oid = r.rngsubopc
left join pg_catalog.pg_collation c on c.oid = r.rngcollation
left join pg_catalog.pg_proc p_subcanon on p_subcanon.oid = r.rngcanonical
left join pg_catalog.pg_namespace pn_subcanon on pn_subcanon.oid = p_subcanon.pronamespace
left join pg_catalog.pg_proc p_subdiff on p_subdiff.oid = r.rngsubdiff
left join pg_catalog.pg_namespace pn_subdiff on pn_subdiff.oid = p_subdiff.pronamespace
left outer join extension_oids e on t.oid = e.objid
where not t.typnamespace::regnamespace::text like any(array['pg\_%', 'information\_schema'])
  and e.objid is null
order by 1, 2;
    `;
    const validated = rows.map((row: unknown) => rangePropsSchema.parse(row));
    return validated.map((row: RangeProps) => new Range(row));
  });
}
