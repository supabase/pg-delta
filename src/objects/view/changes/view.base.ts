import { BaseChange } from "../../base.change.ts";
import type { View } from "../view.model.ts";

abstract class BaseViewChange extends BaseChange {
  abstract readonly view: View;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "view" = "view";
}

export abstract class CreateViewChange extends BaseViewChange {
  readonly operation = "create" as const;
}

export abstract class AlterViewChange extends BaseViewChange {
  readonly operation = "alter" as const;
}

export abstract class DropViewChange extends BaseViewChange {
  readonly operation = "drop" as const;
}
