import { BaseChange } from "../../../base.change.ts";
import type { CompositeType } from "../composite-type.model.ts";

abstract class BaseCompositeTypeChange extends BaseChange {
  abstract readonly compositeType: CompositeType;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "composite_type" = "composite_type";
}

export abstract class CreateCompositeTypeChange extends BaseCompositeTypeChange {
  readonly operation = "create" as const;
}

export abstract class AlterCompositeTypeChange extends BaseCompositeTypeChange {
  readonly operation = "alter" as const;
}

export abstract class DropCompositeTypeChange extends BaseCompositeTypeChange {
  readonly operation = "drop" as const;
}
