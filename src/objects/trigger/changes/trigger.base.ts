import { BaseChange } from "../../base.change.ts";
import type { Trigger } from "../trigger.model.ts";

abstract class BaseTriggerChange extends BaseChange {
  abstract readonly trigger: Trigger;
  abstract readonly scope: "object" | "comment";
  readonly objectType: "trigger" = "trigger";
}

export abstract class CreateTriggerChange extends BaseTriggerChange {
  readonly operation = "create" as const;
}

export abstract class AlterTriggerChange extends BaseTriggerChange {
  readonly operation = "alter" as const;
}

export abstract class DropTriggerChange extends BaseTriggerChange {
  readonly operation = "drop" as const;
}
