import { BaseChange } from "../../base.change.ts";
import type { Rule } from "../rule.model.ts";

abstract class BaseRuleChange extends BaseChange {
  abstract readonly rule: Rule;
  abstract readonly scope: "object" | "comment";
  readonly objectType = "rule" as const;
}

export abstract class CreateRuleChange extends BaseRuleChange {
  readonly operation = "create" as const;
}

export abstract class AlterRuleChange extends BaseRuleChange {
  readonly operation = "alter" as const;
}

export abstract class DropRuleChange extends BaseRuleChange {
  readonly operation = "drop" as const;
}
