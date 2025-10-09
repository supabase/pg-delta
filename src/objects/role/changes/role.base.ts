import { BaseChange } from "../../base.change.ts";
import type { Role } from "../role.model.ts";

abstract class BaseRoleChange extends BaseChange {
  abstract readonly role: Role;
  abstract readonly scope:
    | "object"
    | "comment"
    | "membership"
    | "default_privilege";
  readonly objectType: "role" = "role";
}

export abstract class CreateRoleChange extends BaseRoleChange {
  readonly operation = "create" as const;
}

export abstract class AlterRoleChange extends BaseRoleChange {
  readonly operation = "alter" as const;
}

export abstract class DropRoleChange extends BaseRoleChange {
  readonly operation = "drop" as const;
}
