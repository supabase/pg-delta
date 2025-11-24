import type { AlterServer } from "./server.alter.ts";
import type { CommentServer } from "./server.comment.ts";
import type { CreateServer } from "./server.create.ts";
import type { DropServer } from "./server.drop.ts";
import type { ServerPrivilege } from "./server.privilege.ts";

export type ServerChange =
  | AlterServer
  | CommentServer
  | CreateServer
  | DropServer
  | ServerPrivilege;
