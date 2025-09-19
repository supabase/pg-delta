import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../../base.model.ts";

const columnPrivilegeRowSchema = z.object({
  schema: z.string(),
  table_name: z.string(),
  column_name: z.string(),
  grantee: z.string(),
  privilege_type: z.enum(["SELECT", "INSERT", "UPDATE", "REFERENCES"]),
  is_grantable: z.boolean(),
});

type ColumnPrivilegeRow = z.infer<typeof columnPrivilegeRowSchema>;

const columnPrivilegeSetSchema = z.object({
  schema: z.string(),
  table_name: z.string(),
  table_stable_id: z.string(),
  grantee: z.string(),
  items: z.array(
    z.object({
      privilege: columnPrivilegeRowSchema.shape.privilege_type,
      grantable: z.boolean(),
      columns: z.array(z.string()),
    }),
  ),
});

type ColumnPrivilegeSetProps = z.infer<typeof columnPrivilegeSetSchema>;

export class ColumnPrivilegeSet extends BasePgModel {
  public readonly schema: ColumnPrivilegeSetProps["schema"];
  public readonly table_name: ColumnPrivilegeSetProps["table_name"];
  public readonly table_stable_id: ColumnPrivilegeSetProps["table_stable_id"];
  public readonly grantee: ColumnPrivilegeSetProps["grantee"];
  public readonly items: ColumnPrivilegeSetProps["items"];

  constructor(props: ColumnPrivilegeSetProps) {
    super();
    this.schema = props.schema;
    this.table_name = props.table_name;
    this.table_stable_id = props.table_stable_id;
    this.grantee = props.grantee;
    // Normalize ordering for stable comparisons
    this.items = props.items
      .map((i) => ({
        privilege: i.privilege,
        grantable: i.grantable,
        columns: [...i.columns].sort(),
      }))
      .sort((a, b) =>
        a.privilege === b.privilege
          ? Number(a.grantable) - Number(b.grantable)
          : a.privilege.localeCompare(b.privilege),
      );
  }

  get stableId(): `aclcol:${string}` {
    return `aclcol:${this.table_stable_id}::grantee:${this.grantee}`;
  }

  get identityFields() {
    return {
      table_stable_id: this.table_stable_id,
      grantee: this.grantee,
    };
  }

  get dataFields() {
    return {
      schema: this.schema,
      table_name: this.table_name,
      items: this.items,
    };
  }
}

export async function extractColumnPrivileges(
  sql: Sql,
): Promise<ColumnPrivilegeSet[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const rows = await sql<ColumnPrivilegeRow[]>`
with rels as (
  select c.oid, c.relkind,
         c.relnamespace::regnamespace::text as schema,
         quote_ident(c.relname) as table_name
  from pg_catalog.pg_class c
  left join pg_depend de on de.classid='pg_class'::regclass and de.objid=c.oid and de.refclassid='pg_extension'::regclass
  where c.relkind in ('r','p','v','m')
    and not c.relnamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
    and de.objid is null
)
select
  r.schema,
  r.table_name,
  quote_ident(a.attname) as column_name,
  case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
  x.privilege_type::text as privilege_type,
  x.is_grantable
from rels r
join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
join lateral aclexplode(a.attacl) as x(grantor, grantee, privilege_type, is_grantable) on true
order by 1, 2, 3, 4, 5;
    `;

    const grouped = new Map<
      string,
      {
        schema: string;
        table_name: string;
        table_stable_id: string;
        grantee: string;
        keyToCols: Map<string, string[]>;
      }
    >();
    for (const r of rows) {
      const table_stable_id = `table:${r.schema}.${r.table_name}`;
      const setKey = `${table_stable_id}::${r.grantee}`;
      if (!grouped.has(setKey)) {
        grouped.set(setKey, {
          schema: r.schema,
          table_name: r.table_name,
          table_stable_id,
          grantee: r.grantee,
          keyToCols: new Map<string, string[]>(),
        });
      }
      const g = grouped.get(setKey);
      if (!g) continue;
      const key = `${r.privilege_type}:${r.is_grantable}`;
      if (!g.keyToCols.has(key)) g.keyToCols.set(key, []);
      const arr = g.keyToCols.get(key);
      if (arr) arr.push(r.column_name);
    }

    const sets: ColumnPrivilegeSet[] = [];
    for (const g of grouped.values()) {
      const items = [...g.keyToCols.entries()].map(([key, cols]) => {
        const [privilege, grantableStr] = key.split(":");
        return {
          privilege: privilege as ColumnPrivilegeRow["privilege_type"],
          grantable: grantableStr === "true",
          columns: cols,
        };
      });
      sets.push(
        new ColumnPrivilegeSet(
          columnPrivilegeSetSchema.parse({
            schema: g.schema,
            table_name: g.table_name,
            table_stable_id: g.table_stable_id,
            grantee: g.grantee,
            items,
          }),
        ),
      );
    }

    return sets;
  });
}
