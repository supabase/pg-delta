import { BaseChange } from "../../base.change.ts";
import type { Extension } from "../extension.model.ts";

abstract class BaseExtensionChange extends BaseChange {
  abstract readonly extension: Extension;
  abstract readonly scope: "object" | "comment";
  readonly objectType: "extension" = "extension";
}

export abstract class CreateExtensionChange extends BaseExtensionChange {
  readonly operation = "create" as const;
}

export abstract class AlterExtensionChange extends BaseExtensionChange {
  readonly operation = "alter" as const;
}

export abstract class DropExtensionChange extends BaseExtensionChange {
  readonly operation = "drop" as const;
}
