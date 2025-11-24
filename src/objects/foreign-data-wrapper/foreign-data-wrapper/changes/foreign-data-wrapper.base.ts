import { BaseChange } from "../../../base.change.ts";
import type { ForeignDataWrapper } from "../foreign-data-wrapper.model.ts";

abstract class BaseForeignDataWrapperChange extends BaseChange {
  abstract readonly foreignDataWrapper: ForeignDataWrapper;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "foreign_data_wrapper" = "foreign_data_wrapper";
}

export abstract class CreateForeignDataWrapperChange extends BaseForeignDataWrapperChange {
  readonly operation = "create" as const;
}

export abstract class AlterForeignDataWrapperChange extends BaseForeignDataWrapperChange {
  readonly operation = "alter" as const;
}

export abstract class DropForeignDataWrapperChange extends BaseForeignDataWrapperChange {
  readonly operation = "drop" as const;
}
