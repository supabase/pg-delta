import { BaseChange } from "../../base.change.ts";
import type { EventTrigger } from "../event-trigger.model.ts";

abstract class BaseEventTriggerChange extends BaseChange {
  abstract readonly eventTrigger: EventTrigger;
  abstract readonly scope: "object" | "comment";
  readonly objectType = "event_trigger" as const;
}

export abstract class CreateEventTriggerChange extends BaseEventTriggerChange {
  readonly operation = "create" as const;
}

export abstract class AlterEventTriggerChange extends BaseEventTriggerChange {
  readonly operation = "alter" as const;
}

export abstract class DropEventTriggerChange extends BaseEventTriggerChange {
  readonly operation = "drop" as const;
}
