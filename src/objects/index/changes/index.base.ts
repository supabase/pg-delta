import { BaseChange } from "../../base.change.ts";
import type { Index } from "../index.model.ts";

abstract class BaseIndexChange extends BaseChange {
  abstract readonly index: Index;
  abstract readonly scope: "object" | "comment";
  readonly objectType: "index" = "index";
}

export abstract class CreateIndexChange extends BaseIndexChange {
  readonly operation = "create" as const;
}

export abstract class AlterIndexChange extends BaseIndexChange {
  readonly operation = "alter" as const;
}

export abstract class DropIndexChange extends BaseIndexChange {
  readonly operation = "drop" as const;
}
