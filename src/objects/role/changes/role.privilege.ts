import { BaseChange } from "../../base.change.ts";
import type { Role } from "../role.model.ts";

export type RolePrivilege =
  | GrantRoleMembership
  | RevokeRoleMembership
  | RevokeMembershipOptions;

/**
 * Grant role membership.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT role_name [, ...] TO role_specification [, ...]
 *     [ WITH ADMIN OPTION ]
 *     [ GRANTED BY role_specification ]
 * ```
 */
export class GrantRoleMembership extends BaseChange {
  public readonly role: Role;
  public readonly member: string;
  public readonly options: {
    admin: boolean;
    inherit?: boolean | null;
    set?: boolean | null;
  };
  public readonly operation = "create" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "role" as const;

  constructor(props: {
    role: Role;
    member: string;
    options: { admin: boolean; inherit?: boolean | null; set?: boolean | null };
  }) {
    super();
    this.role = props.role;
    this.member = props.member;
    this.options = props.options;
  }

  get dependencies() {
    const membershipStableId = `membership:${this.role.role_name}->${this.member}`;
    return [membershipStableId];
  }

  serialize(): string {
    // On creation, only emit ADMIN OPTION; leave INHERIT/SET to defaults
    const opts: string[] = [];
    if (this.options.admin) opts.push("ADMIN OPTION");
    const withClause = opts.length > 0 ? ` WITH ${opts.join(" ")}` : "";
    return `GRANT ${this.role.role_name} TO ${this.member}${withClause}`;
  }
}

/**
 * Revoke role membership.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ ADMIN OPTION FOR ] role_name [, ...] FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeRoleMembership extends BaseChange {
  public readonly role: Role;
  public readonly member: string;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "role" as const;

  constructor(props: { role: Role; member: string }) {
    super();
    this.role = props.role;
    this.member = props.member;
  }

  get dependencies() {
    const membershipStableId = `membership:${this.role.role_name}->${this.member}`;
    return [membershipStableId];
  }

  serialize(): string {
    return `REVOKE ${this.role.role_name} FROM ${this.member}`;
  }
}

/**
 * Revoke membership options for a role.
 *
 * This removes specific options (ADMIN, INHERIT, SET) from a role membership,
 * but keeps the membership itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeMembershipOptions extends BaseChange {
  public readonly role: Role;
  public readonly member: string;
  public readonly admin?: boolean;
  public readonly inherit?: boolean;
  public readonly set?: boolean;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "role" as const;

  constructor(props: {
    role: Role;
    member: string;
    admin?: boolean;
    inherit?: boolean;
    set?: boolean;
  }) {
    super();
    this.role = props.role;
    this.member = props.member;
    this.admin = props.admin;
    this.inherit = props.inherit;
    this.set = props.set;
  }

  get dependencies() {
    const membershipStableId = `membership:${this.role.role_name}->${this.member}`;
    return [membershipStableId];
  }

  serialize(): string {
    const parts: string[] = [];
    if (this.admin) parts.push("ADMIN OPTION");
    if (this.inherit) parts.push("INHERIT OPTION");
    if (this.set) parts.push("SET OPTION");
    return `REVOKE ${parts.join(" ")} FOR ${this.role.role_name} FROM ${this.member}`;
  }
}
