import { BaseChange } from "../../base.change.ts";
import type { Publication } from "../publication.model.ts";

abstract class BasePublicationChange extends BaseChange {
  abstract readonly publication: Publication;
  abstract readonly scope: "object" | "comment";
  readonly objectType = "publication" as const;
}

export abstract class CreatePublicationChange extends BasePublicationChange {
  readonly operation = "create" as const;
}

export abstract class AlterPublicationChange extends BasePublicationChange {
  readonly operation = "alter" as const;
}

export abstract class DropPublicationChange extends BasePublicationChange {
  readonly operation = "drop" as const;
}
