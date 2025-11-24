import type { AlterForeignTable } from "./foreign-table.alter.ts";
import type { CommentForeignTable } from "./foreign-table.comment.ts";
import type { CreateForeignTable } from "./foreign-table.create.ts";
import type { DropForeignTable } from "./foreign-table.drop.ts";
import type { ForeignTablePrivilege } from "./foreign-table.privilege.ts";

export type ForeignTableChange =
  | AlterForeignTable
  | CommentForeignTable
  | CreateForeignTable
  | DropForeignTable
  | ForeignTablePrivilege;
