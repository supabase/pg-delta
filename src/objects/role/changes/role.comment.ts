import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Role } from "../role.model.ts";
import { CreateRoleChange, DropRoleChange } from "./role.base.ts";

export type CommentRole = CreateCommentOnRole | DropCommentOnRole;

export class CreateCommentOnRole extends CreateRoleChange {
  public readonly role: Role;
  public readonly scope = "comment" as const;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  get creates() {
    return [stableId.comment(this.role.stableId)];
  }

  get requires() {
    return [this.role.stableId];
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

export class DropCommentOnRole extends DropRoleChange {
  public readonly role: Role;
  public readonly scope = "comment" as const;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  get drops() {
    return [stableId.comment(this.role.stableId)];
  }

  get requires() {
    return [stableId.comment(this.role.stableId), this.role.stableId];
  }

  serialize(): string {
    return ["COMMENT ON ROLE", this.role.name, "IS NULL"].join(" ");
  }
}
