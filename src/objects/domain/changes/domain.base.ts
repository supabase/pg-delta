import { BaseChange } from "../../base.change.ts";
import type { Domain } from "../domain.model.ts";

abstract class BaseDomainChange extends BaseChange {
  abstract readonly domain: Domain;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "domain" = "domain";
}

export abstract class CreateDomainChange extends BaseDomainChange {
  readonly operation = "create" as const;
}

export abstract class AlterDomainChange extends BaseDomainChange {
  readonly operation = "alter" as const;
}

export abstract class DropDomainChange extends BaseDomainChange {
  readonly operation = "drop" as const;
}
