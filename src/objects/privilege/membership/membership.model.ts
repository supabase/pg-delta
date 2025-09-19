import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../../base.model.ts";

const membershipPropsSchema = z.object({
  role: z.string(),
  member: z.string(),
  grantor: z.string(),
  admin_option: z.boolean(),
  inherit_option: z.boolean().optional(),
  set_option: z.boolean().optional(),
});

export type MembershipProps = z.infer<typeof membershipPropsSchema>;

export class RoleMembership extends BasePgModel {
  public readonly role: MembershipProps["role"];
  public readonly member: MembershipProps["member"];
  public readonly grantor: MembershipProps["grantor"];
  public readonly admin_option: MembershipProps["admin_option"];
  public readonly inherit_option?: MembershipProps["inherit_option"];
  public readonly set_option?: MembershipProps["set_option"];

  constructor(props: MembershipProps) {
    super();
    this.role = props.role;
    this.member = props.member;
    this.grantor = props.grantor;
    this.admin_option = props.admin_option;
    this.inherit_option = props.inherit_option;
    this.set_option = props.set_option;
  }

  get stableId(): `membership:${string}` {
    return `membership:${this.role}->${this.member}`;
  }

  get identityFields() {
    return {
      role: this.role,
      member: this.member,
    };
  }

  get dataFields() {
    return {
      grantor: this.grantor,
      admin_option: this.admin_option,
      inherit_option: this.inherit_option ?? null,
      set_option: this.set_option ?? null,
    };
  }
}

export async function extractRoleMemberships(
  sql: Sql,
): Promise<RoleMembership[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const [capabilities] = await sql<
      { has_inherit: boolean; has_set: boolean }[]
    >`
      select
        exists (
          select 1
          from pg_attribute
          where attrelid = 'pg_auth_members'::regclass
            and attname = 'inherit_option'
        ) as has_inherit,
        exists (
          select 1
          from pg_attribute
          where attrelid = 'pg_auth_members'::regclass
            and attname = 'set_option'
        ) as has_set
    `;

    const rows =
      capabilities?.has_inherit && capabilities?.has_set
        ? await sql`
select
  r.rolname as role,
  m.rolname as member,
  g.rolname as grantor,
  am.admin_option,
  am.inherit_option,   -- PG16+
  am.set_option        -- PG16+
from pg_auth_members am
join pg_roles r on r.oid = am.roleid
join pg_roles m on m.oid = am.member
join pg_roles g on g.oid = am.grantor
order by 1, 2;
      `
        : await sql`
-- PG15: columns inherit_option and set_option do not exist
select
  r.rolname as role,
  m.rolname as member,
  g.rolname as grantor,
  am.admin_option
from pg_auth_members am
join pg_roles r on r.oid = am.roleid
join pg_roles m on m.oid = am.member
join pg_roles g on g.oid = am.grantor
order by 1, 2;
      `;

    return rows.map(
      (row: unknown) => new RoleMembership(membershipPropsSchema.parse(row)),
    );
  });
}
