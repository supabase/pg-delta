import type { CreateExtensionStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types/context.ts";
import type { ExtensionDefinition } from "../types/objects/extension.ts";
import { isString } from "./guards.ts";

export function handleCreateExtensionStmt(
  ctx: ParseContext,
  node: CreateExtensionStmt,
) {
  if (!node.extname) return;

  let schema = "public";

  for (const option of node.options ?? []) {
    if ("DefElem" in option) {
      const defElem = option.DefElem;
      if (defElem.defname === "schema" && isString(defElem.arg)) {
        schema = defElem.arg.String.sval;
        break;
      }
    }
  }

  const extensionDefinition: ExtensionDefinition = {
    id: node.extname,
    name: node.extname,
    schema,
    statement: node,
  };

  ctx.extensions.set(node.extname, extensionDefinition);
}
