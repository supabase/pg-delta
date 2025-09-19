import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../../base.model.ts";

const defaultPrivilegeRowSchema = z.object({
  grantor: z.string(),
  in_schema: z.string().nullable(),
  objtype: z.enum(["r", "S", "f", "T", "n"]),
  grantee: z.string(),
  privilege_type: z.string(),
  is_grantable: z.boolean(),
});

type DefaultPrivilegeRow = z.infer<typeof defaultPrivilegeRowSchema>;

const defaultPrivilegeSetSchema = z.object({
  grantor: z.string(),
  in_schema: z.string().nullable(),
  objtype: defaultPrivilegeRowSchema.shape.objtype,
  grantee: z.string(),
  privileges: z.array(
    z.object({ privilege: z.string(), grantable: z.boolean() }),
  ),
});

type DefaultPrivilegeSetProps = z.infer<
  typeof defaultPrivilegeSetSchema
>;

export class DefaultPrivilegeSet extends BasePgModel {
  public readonly grantor: DefaultPrivilegeSetProps["grantor"];
  public readonly in_schema: DefaultPrivilegeSetProps["in_schema"];
  public readonly objtype: DefaultPrivilegeSetProps["objtype"];
  public readonly grantee: DefaultPrivilegeSetProps["grantee"];
  public readonly privileges: DefaultPrivilegeSetProps["privileges"];

  constructor(props: DefaultPrivilegeSetProps) {
    super();
    this.grantor = props.grantor;
    this.in_schema = props.in_schema;
    this.objtype = props.objtype;
    this.grantee = props.grantee;
    this.privileges = [...props.privileges].sort((a, b) => {
      if (a.privilege === b.privilege) {
        return Number(a.grantable) - Number(b.grantable);
      }
      return a.privilege.localeCompare(b.privilege);
    });
  }

  get stableId(): `defacl:${string}` {
    const scope = this.in_schema ? `schema:${this.in_schema}` : "global";
    return `defacl:${this.grantor}:${this.objtype}:${scope}:grantee:${this.grantee}`;
  }

  get identityFields() {
    return {
      grantor: this.grantor,
      in_schema: this.in_schema,
      objtype: this.objtype,
      grantee: this.grantee,
    };
  }

  get dataFields() {
    return {
      privileges: this.privileges,
    };
  }
}

export async function extractDefaultPrivileges(
  sql: Sql,
): Promise<DefaultPrivilegeSet[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const rows = await sql<DefaultPrivilegeRow[]>`
select
  d.defaclrole::regrole::text as grantor,
  case when d.defaclnamespace = 0 then null else d.defaclnamespace::regnamespace::text end as in_schema,
  d.defaclobjtype as objtype,
  case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
  x.privilege_type,
  x.is_grantable
from pg_default_acl d
cross join lateral aclexplode(coalesce(d.defaclacl, ARRAY[]::aclitem[])) as x(grantor, grantee, privilege_type, is_grantable)
order by 1, 2 nulls first, 3, 4, 5;
    `;

    const grouped = new Map<string, DefaultPrivilegeSetProps>();
    for (const r of rows) {
      const key = `${r.grantor}:${r.in_schema ?? ""}:${r.objtype}:${r.grantee}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          grantor: r.grantor,
          in_schema: r.in_schema,
          objtype: r.objtype,
          grantee: r.grantee,
          privileges: [],
        });
      }
      const entry = grouped.get(key);
      if (entry) {
        entry.privileges.push({
          privilege: r.privilege_type,
          grantable: r.is_grantable,
        });
      }
    }

    return [...grouped.values()].map(
      (g) => new DefaultPrivilegeSet(defaultPrivilegeSetSchema.parse(g)),
    );
  });
}
