import { BaseChange } from "../../../base.change.ts";
import type { Enum } from "../enum.model.ts";

abstract class BaseEnumChange extends BaseChange {
  abstract readonly enum: Enum;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "enum" = "enum";
}

export abstract class CreateEnumChange extends BaseEnumChange {
  readonly operation = "create" as const;
}

export abstract class AlterEnumChange extends BaseEnumChange {
  readonly operation = "alter" as const;
}

export abstract class DropEnumChange extends BaseEnumChange {
  readonly operation = "drop" as const;
}
