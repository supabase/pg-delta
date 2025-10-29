import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";
import {
  CreateRlsPolicyChange,
  DropRlsPolicyChange,
} from "./rls-policy.base.ts";

export type CommentRlsPolicy =
  | CreateCommentOnRlsPolicy
  | DropCommentOnRlsPolicy;

export class CreateCommentOnRlsPolicy extends CreateRlsPolicyChange {
  public readonly policy: RlsPolicy;
  public readonly scope = "comment" as const;

  constructor(props: { policy: RlsPolicy }) {
    super();
    this.policy = props.policy;
  }

  get creates() {
    return [stableId.comment(this.policy.stableId)];
  }

  get requires() {
    return [this.policy.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON POLICY",
      this.policy.name,
      "ON",
      `${this.policy.schema}.${this.policy.table_name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: rls policy comment is not nullable in this case
      quoteLiteral(this.policy.comment!),
    ].join(" ");
  }
}

export class DropCommentOnRlsPolicy extends DropRlsPolicyChange {
  public readonly policy: RlsPolicy;
  public readonly scope = "comment" as const;

  constructor(props: { policy: RlsPolicy }) {
    super();
    this.policy = props.policy;
  }

  get drops() {
    return [stableId.comment(this.policy.stableId)];
  }

  get requires() {
    return [stableId.comment(this.policy.stableId), this.policy.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON POLICY",
      this.policy.name,
      "ON",
      `${this.policy.schema}.${this.policy.table_name}`,
      "IS NULL",
    ].join(" ");
  }
}
