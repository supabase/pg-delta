import { stableId } from "../../utils.ts";
import type { Rule, RuleEnabledState } from "../rule.model.ts";
import { AlterRuleChange } from "./rule.base.ts";
import { CreateRule } from "./rule.create.ts";

export class ReplaceRule extends AlterRuleChange {
  public readonly rule: Rule;
  public readonly scope = "object" as const;

  constructor(props: { rule: Rule }) {
    super();
    this.rule = props.rule;
  }

  get requires() {
    return [
      this.rule.stableId,
      this.rule.relationStableId,
      ...this.rule.columns.map((column) =>
        stableId.column(this.rule.schema, this.rule.table_name, column),
      ),
    ];
  }

  serialize(): string {
    return new CreateRule({ rule: this.rule, orReplace: true }).serialize();
  }
}

export class SetRuleEnabledState extends AlterRuleChange {
  public readonly rule: Rule;
  public readonly scope = "object" as const;
  public readonly enabled: RuleEnabledState;

  constructor(props: { rule: Rule; enabled?: RuleEnabledState }) {
    super();
    this.rule = props.rule;
    this.enabled = props.enabled ?? props.rule.enabled;
  }

  get requires() {
    return [
      this.rule.stableId,
      this.rule.relationStableId,
      ...this.rule.columns.map((column) =>
        stableId.column(this.rule.schema, this.rule.table_name, column),
      ),
    ];
  }

  serialize(): string {
    const clause = clauseForState(this.enabled);
    return `ALTER TABLE ${this.rule.schema}.${this.rule.table_name} ${clause} ${this.rule.name}`;
  }
}

function clauseForState(state: RuleEnabledState) {
  switch (state) {
    case "O":
      return "ENABLE RULE";
    case "D":
      return "DISABLE RULE";
    case "R":
      return "ENABLE REPLICA RULE";
    case "A":
      return "ENABLE ALWAYS RULE";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
