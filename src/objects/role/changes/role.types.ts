import type { AlterRole } from "./role.alter.ts";
import type { CommentRole } from "./role.comment.ts";
import type { CreateRole } from "./role.create.ts";
import type { DropRole } from "./role.drop.ts";
import type { RolePrivilege } from "./role.privilege.ts";

export type RoleChange =
  | AlterRole
  | CommentRole
  | CreateRole
  | DropRole
  | RolePrivilege;
