import { Change } from "../../../base.change.ts";

export class RevokeRoleMembership extends Change {
  public readonly role: string;
  public readonly member: string;
  public readonly operation = "drop" as const;
  public readonly scope = "membership" as const;
  public readonly objectType = "role" as const;

  constructor(props: { role: string; member: string }) {
    super();
    this.role = props.role;
    this.member = props.member;
  }

  get dependencies() {
    const membershipStableId = `membership:${this.role}->${this.member}`;
    return [membershipStableId];
  }

  serialize(): string {
    return `REVOKE ${this.role} FROM ${this.member}`;
  }
}

export class RevokeMembershipOptions extends Change {
  public readonly role: string;
  public readonly member: string;
  public readonly admin?: boolean;
  public readonly inherit?: boolean;
  public readonly set?: boolean;
  public readonly operation = "drop" as const;
  public readonly scope = "membership" as const;
  public readonly objectType = "role" as const;

  constructor(props: {
    role: string;
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
    const membershipStableId = `membership:${this.role}->${this.member}`;
    return [membershipStableId];
  }

  serialize(): string {
    const parts: string[] = [];
    if (this.admin) parts.push("ADMIN OPTION");
    if (this.inherit) parts.push("INHERIT OPTION");
    if (this.set) parts.push("SET OPTION");
    return `REVOKE ${parts.join(" ")} FOR ${this.role} FROM ${this.member}`;
  }
}
