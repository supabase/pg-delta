import { BaseChange } from "../../../base.change.ts";
import type { UserMapping } from "../user-mapping.model.ts";

abstract class BaseUserMappingChange extends BaseChange {
  abstract readonly userMapping: UserMapping;
  abstract readonly scope: "object";
  readonly objectType: "user_mapping" = "user_mapping";
}

export abstract class CreateUserMappingChange extends BaseUserMappingChange {
  readonly operation = "create" as const;
}

export abstract class AlterUserMappingChange extends BaseUserMappingChange {
  readonly operation = "alter" as const;
}

export abstract class DropUserMappingChange extends BaseUserMappingChange {
  readonly operation = "drop" as const;
}
