import type { CompositeTypeStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types/context.ts";

export function handleCompositeTypeStmt(
  ctx: ParseContext,
  node: CompositeTypeStmt,
) {
  if (!node.typevar?.relname) {
    throw new Error("Composite type must have a name");
  }

  const schema = node.typevar.schemaname ?? "public";

  const id = `${node.typevar.schemaname}.${node.typevar.relname}`;

  ctx.types.set(id, {
    id,
    schema,
    name: node.typevar.relname,
    kind: "composite",
    statement: node,
  });
}
