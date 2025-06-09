import type { CreateSchemaStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types.ts";

export function handleCreateSchemaStmt(
  ctx: ParseContext,
  node: CreateSchemaStmt,
) {
  if (!node.schemaname) return;

  ctx.schemas.set(node.schemaname, node);
}
