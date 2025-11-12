import { BaseChange } from "../../base.change.ts";
import type { Aggregate } from "../aggregate.model.ts";

abstract class BaseAggregateChange extends BaseChange {
  abstract readonly aggregate: Aggregate;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "aggregate" = "aggregate";
}

export abstract class CreateAggregateChange extends BaseAggregateChange {
  readonly operation = "create" as const;
}

export abstract class AlterAggregateChange extends BaseAggregateChange {
  readonly operation = "alter" as const;
}

export abstract class DropAggregateChange extends BaseAggregateChange {
  readonly operation = "drop" as const;
}
