import { BaseChange } from "../../../base.change.ts";
import type { Server } from "../server.model.ts";

abstract class BaseServerChange extends BaseChange {
  abstract readonly server: Server;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "server" = "server";
}

export abstract class CreateServerChange extends BaseServerChange {
  readonly operation = "create" as const;
}

export abstract class AlterServerChange extends BaseServerChange {
  readonly operation = "alter" as const;
}

export abstract class DropServerChange extends BaseServerChange {
  readonly operation = "drop" as const;
}
