import { Change } from "../../../base.change.ts";

export class GrantRoleMembership extends Change {
  public readonly role: string;
  public readonly member: string;
  public readonly options: {
    admin: boolean;
    inherit?: boolean | null;
    set?: boolean | null;
  };
  public readonly operation = "create" as const;
  public readonly scope = "membership" as const;
  public readonly objectType = "role" as const;

  constructor(props: {
    role: string;
    member: string;
    options: { admin: boolean; inherit?: boolean | null; set?: boolean | null };
  }) {
    super();
    this.role = props.role;
    this.member = props.member;
    this.options = props.options;
  }

  get dependencies() {
    const membershipStableId = `membership:${this.role}->${this.member}`;
    return [membershipStableId];
  }

  serialize(): string {
    // On creation, only emit ADMIN OPTION; leave INHERIT/SET to defaults
    const opts: string[] = [];
    if (this.options.admin) opts.push("ADMIN OPTION");
    const withClause = opts.length > 0 ? ` WITH ${opts.join(" ")}` : "";
    return `GRANT ${this.role} TO ${this.member}${withClause}`;
  }
}
