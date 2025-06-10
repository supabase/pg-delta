import type { CreateEnumStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types/context.ts";
import { getObjectIdentifier } from "./utils.ts";

export function handleCreateEnumStmt(ctx: ParseContext, node: CreateEnumStmt) {
  if (!node.typeName) return;

  const { id, schema, name } = getObjectIdentifier(node.typeName);

  ctx.types.set(id, {
    id,
    schema,
    name,
    kind: "enum",
    statement: node,
  });
}
