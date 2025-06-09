import type { CreateStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../../types.ts";
import {
  handleCreateTableStmt,
  isCreateTableStmt,
} from "./create-table-stmt.ts";

export function handleCreateStmt(ctx: ParseContext, node: CreateStmt) {
  if (isCreateTableStmt(node)) {
    const tableDefinition = handleCreateTableStmt(node);
    ctx.tables.set(tableDefinition.id, tableDefinition);
  } else {
    throw new Error(
      `Unhandled node type in create stmt ${JSON.stringify(node)}`,
    );
  }
}
