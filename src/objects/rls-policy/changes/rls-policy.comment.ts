import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";

export class CreateCommentOnRlsPolicy extends CreateChange {
  public readonly rlsPolicy: RlsPolicy;

  constructor(props: { rlsPolicy: RlsPolicy }) {
    super();
    this.rlsPolicy = props.rlsPolicy;
  }

  get dependencies() {
    return [
      `comment:${this.rlsPolicy.schema}.${this.rlsPolicy.table_name}.${this.rlsPolicy.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON POLICY",
      this.rlsPolicy.name,
      "ON",
      `${this.rlsPolicy.schema}.${this.rlsPolicy.table_name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: rls policy comment is not nullable in this case
      quoteLiteral(this.rlsPolicy.comment!),
    ].join(" ");
  }
}

export class DropCommentOnRlsPolicy extends DropChange {
  public readonly rlsPolicy: RlsPolicy;

  constructor(props: { rlsPolicy: RlsPolicy }) {
    super();
    this.rlsPolicy = props.rlsPolicy;
  }

  get dependencies() {
    return [
      `comment:${this.rlsPolicy.schema}.${this.rlsPolicy.table_name}.${this.rlsPolicy.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON POLICY",
      this.rlsPolicy.name,
      "ON",
      `${this.rlsPolicy.schema}.${this.rlsPolicy.table_name}`,
      "IS NULL",
    ].join(" ");
  }
}
