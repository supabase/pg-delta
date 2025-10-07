import { BaseChange, quoteLiteral } from "../../base.change.ts";
import type { Role } from "../role.model.ts";

export type CommentRole = CreateCommentOnRole | DropCommentOnRole;

export class CreateCommentOnRole extends BaseChange {
  public readonly role: Role;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "role" as const;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  get dependencies() {
    return [`comment:${this.role.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON ROLE",
      this.role.name,
      "IS",
      quoteLiteral(this.role.comment as string),
    ].join(" ");
  }
}

export class DropCommentOnRole extends BaseChange {
  public readonly role: Role;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "role" as const;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  get dependencies() {
    return [`comment:${this.role.name}`];
  }

  serialize(): string {
    return ["COMMENT ON ROLE", this.role.name, "IS NULL"].join(" ");
  }
}
