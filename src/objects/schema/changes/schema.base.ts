import { BaseChange } from "../../base.change.ts";
import type { Schema } from "../schema.model.ts";

abstract class BaseSchemaChange extends BaseChange {
  abstract readonly schema: Schema;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "schema" = "schema";
}

export abstract class CreateSchemaChange extends BaseSchemaChange {
  readonly operation = "create" as const;
}

export abstract class AlterSchemaChange extends BaseSchemaChange {
  readonly operation = "alter" as const;
}

export abstract class DropSchemaChange extends BaseSchemaChange {
  readonly operation = "drop" as const;
}
