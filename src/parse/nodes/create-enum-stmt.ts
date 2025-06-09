import type { CreateEnumStmt, Node } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types.ts";
import { isString } from "./guards.ts";

export function getTypeId(typeName: Node[]) {
  if (typeName.length === 1 && isString(typeName[0])) {
    return `public.${typeName[0].String.sval}`;
  }

  if (typeName.length === 2 && isString(typeName[0]) && isString(typeName[1])) {
    return `${typeName[0].String.sval}.${typeName[1].String.sval}`;
  }

  throw new Error(`Invalid type name: ${JSON.stringify(typeName)}`);
}

export function handleCreateEnumStmt(ctx: ParseContext, node: CreateEnumStmt) {
  if (!node.typeName) return;
  if (node.typeName.length === 1 && isString(node.typeName[0])) {
    const schema = "public";
    const name = node.typeName[0].String.sval;
    const id = `${schema}.${name}`;

    ctx.types.set(id, {
      id,
      schema,
      name,
      kind: "enum",
      statement: node,
    });
  }

  if (
    node.typeName?.length === 2 &&
    isString(node.typeName[0]) &&
    isString(node.typeName[1])
  ) {
    const schema = node.typeName[0].String.sval;
    const name = node.typeName[1].String.sval;
    const id = `${schema}.${name}`;

    ctx.types.set(id, {
      id,
      schema,
      name,
      kind: "enum",
      statement: node,
    });
  }
}
