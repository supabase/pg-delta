import type { CreateFunctionStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types/context.ts";
import type { FunctionDefinition } from "../types/objects/function.ts";
import { getObjectIdentifier } from "./utils.ts";

export function handleCreateFunctionStmt(
  ctx: ParseContext,
  node: CreateFunctionStmt,
) {
  if (!node.funcname) return;

  const objectIdentifier = getObjectIdentifier(node.funcname);
  const functionDefinition: FunctionDefinition = {
    id: objectIdentifier.id,
    schema: objectIdentifier.schema,
    name: objectIdentifier.name,
    statement: node,
  };

  ctx.functions.set(objectIdentifier.id, functionDefinition);
}
