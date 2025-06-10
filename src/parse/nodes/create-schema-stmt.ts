import type { CreateSchemaStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types/context.ts";
import type { SchemaDefinition } from "../types/objects/schema.ts";

export function handleCreateSchemaStmt(
  ctx: ParseContext,
  node: CreateSchemaStmt,
) {
  if (!node.schemaname) return;

  const schemaDefinition: SchemaDefinition = {
    id: node.schemaname,
    name: node.schemaname,
    statement: node,
  };

  ctx.schemas.set(node.schemaname, schemaDefinition);
}
