import { BaseChange } from "../../base.change.ts";
import type { Subscription } from "../subscription.model.ts";

abstract class BaseSubscriptionChange extends BaseChange {
  abstract readonly subscription: Subscription;
  abstract readonly scope: "object" | "comment";
  readonly objectType = "subscription" as const;
}

export abstract class CreateSubscriptionChange extends BaseSubscriptionChange {
  readonly operation = "create" as const;
}

export abstract class AlterSubscriptionChange extends BaseSubscriptionChange {
  readonly operation = "alter" as const;
}

export abstract class DropSubscriptionChange extends BaseSubscriptionChange {
  readonly operation = "drop" as const;
}
