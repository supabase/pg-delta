import { BaseChange } from "../../../base.change.ts";
import type { Range } from "../range.model.ts";

abstract class BaseRangeChange extends BaseChange {
  abstract readonly range: Range;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "range" = "range";
}

export abstract class CreateRangeChange extends BaseRangeChange {
  readonly operation = "create" as const;
}

export abstract class AlterRangeChange extends BaseRangeChange {
  readonly operation = "alter" as const;
}

export abstract class DropRangeChange extends BaseRangeChange {
  readonly operation = "drop" as const;
}
