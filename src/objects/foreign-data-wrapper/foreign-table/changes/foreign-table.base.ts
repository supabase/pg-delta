import { BaseChange } from "../../../base.change.ts";
import type { ForeignTable } from "../foreign-table.model.ts";

abstract class BaseForeignTableChange extends BaseChange {
  abstract readonly foreignTable: ForeignTable;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "foreign_table" = "foreign_table";
}

export abstract class CreateForeignTableChange extends BaseForeignTableChange {
  readonly operation = "create" as const;
}

export abstract class AlterForeignTableChange extends BaseForeignTableChange {
  readonly operation = "alter" as const;
}

export abstract class DropForeignTableChange extends BaseForeignTableChange {
  readonly operation = "drop" as const;
}
