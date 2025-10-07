import { BaseChange } from "../../base.change.ts";
import type { Collation } from "../collation.model.ts";

export abstract class BaseCollationChange extends BaseChange {
  abstract readonly collation: Collation;
  abstract readonly scope: "object" | "comment";
  readonly objectType: "collation" = "collation";
}

export abstract class CreateCollationChange extends BaseCollationChange {
  readonly operation = "create" as const;
}

export abstract class AlterCollationChange extends BaseCollationChange {
  readonly operation = "alter" as const;
}

export abstract class DropCollationChange extends BaseCollationChange {
  readonly operation = "drop" as const;
}
