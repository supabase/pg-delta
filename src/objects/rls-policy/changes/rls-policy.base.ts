import { BaseChange } from "../../base.change.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";

abstract class BaseRlsPolicyChange extends BaseChange {
  abstract readonly policy: RlsPolicy;
  abstract readonly scope: "object" | "comment";
  readonly objectType: "rls_policy" = "rls_policy";
}

export abstract class CreateRlsPolicyChange extends BaseRlsPolicyChange {
  readonly operation = "create" as const;
}

export abstract class AlterRlsPolicyChange extends BaseRlsPolicyChange {
  readonly operation = "alter" as const;
}

export abstract class DropRlsPolicyChange extends BaseRlsPolicyChange {
  readonly operation = "drop" as const;
}
