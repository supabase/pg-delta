import { BaseChange } from "../../base.change.ts";
import type { Table } from "../table.model.ts";

abstract class BaseTableChange extends BaseChange {
  abstract readonly table: Table;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "table" = "table";
}

export abstract class CreateTableChange extends BaseTableChange {
  readonly operation = "create" as const;
}

export abstract class AlterTableChange extends BaseTableChange {
  readonly operation = "alter" as const;
}

export abstract class DropTableChange extends BaseTableChange {
  readonly operation = "drop" as const;
}
