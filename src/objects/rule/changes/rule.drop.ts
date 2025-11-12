import type { Rule } from "../rule.model.ts";
import { DropRuleChange } from "./rule.base.ts";

export class DropRule extends DropRuleChange {
  public readonly rule: Rule;
  public readonly scope = "object" as const;

  constructor(props: { rule: Rule }) {
    super();
    this.rule = props.rule;
  }

  get drops() {
    return [this.rule.stableId];
  }

  get requires() {
    return [this.rule.stableId, this.rule.relationStableId];
  }

  serialize(): string {
    return [
      "DROP RULE",
      this.rule.name,
      "ON",
      `${this.rule.schema}.${this.rule.table_name}`,
    ].join(" ");
  }
}
