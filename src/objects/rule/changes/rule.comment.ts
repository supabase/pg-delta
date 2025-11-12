import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Rule } from "../rule.model.ts";
import { CreateRuleChange, DropRuleChange } from "./rule.base.ts";

export class CreateCommentOnRule extends CreateRuleChange {
  public readonly rule: Rule;
  public readonly scope = "comment" as const;

  constructor(props: { rule: Rule }) {
    super();
    this.rule = props.rule;
  }

  get creates() {
    return [stableId.comment(this.rule.stableId)];
  }

  get requires() {
    return [this.rule.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON RULE",
      this.rule.name,
      "ON",
      `${this.rule.schema}.${this.rule.table_name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: rule comment is not nullable in this case
      quoteLiteral(this.rule.comment!),
    ].join(" ");
  }
}

export class DropCommentOnRule extends DropRuleChange {
  public readonly rule: Rule;
  public readonly scope = "comment" as const;

  constructor(props: { rule: Rule }) {
    super();
    this.rule = props.rule;
  }

  get drops() {
    return [stableId.comment(this.rule.stableId)];
  }

  get requires() {
    return [stableId.comment(this.rule.stableId), this.rule.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON RULE",
      this.rule.name,
      "ON",
      `${this.rule.schema}.${this.rule.table_name}`,
      "IS NULL",
    ].join(" ");
  }
}
