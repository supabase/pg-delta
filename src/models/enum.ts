import type { Sql } from "postgres";
import { BasePgModel } from "./base.ts";

interface EnumLabel {
  sort_order: number;
  label: string;
}

interface EnumProps {
  schema: string;
  name: string;
  owner: string;
  labels: EnumLabel[];
}

export class Enum extends BasePgModel {
  public readonly schema: EnumProps["schema"];
  public readonly name: EnumProps["name"];
  public readonly owner: EnumProps["owner"];
  public readonly labels: EnumProps["labels"];

  constructor(props: EnumProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.owner = props.owner;
    this.labels = props.labels;
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
    };
  }
}

export async function extractEnums(sql: Sql): Promise<Enum[]> {
  const enumRows = await sql<
    {
      schema: string;
      name: string;
      owner: string;
      sort_order: number;
      label: string;
    }[]
  >`
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
  t.typnamespace::regnamespace as schema,
  t.typname as name,
  e.enumsortorder as sort_order,
  e.enumlabel as label,
  t.typowner::regrole as owner
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
      };
    }
    grouped[key].labels.push({ sort_order: e.sort_order, label: e.label });
  }
  return Object.values(grouped).map((e) => new Enum(e));
}
