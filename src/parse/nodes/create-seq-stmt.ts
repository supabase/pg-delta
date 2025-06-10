import type { CreateSeqStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types/context.ts";
import type { SequenceDefinition } from "../types/objects/sequence.ts";

export function handleCreateSeqStmt(ctx: ParseContext, node: CreateSeqStmt) {
  const schema = node.sequence?.schemaname ?? "public";

  if (!node.sequence?.relname) {
    throw new Error(
      `Undefined sequence name in create seq stmt ${JSON.stringify(node)}`,
    );
  }

  const id = `${schema}.${node.sequence.relname}`;

  const sequenceDefinition: SequenceDefinition = {
    id,
    name: node.sequence.relname,
    schema,
    statement: node,
  };

  ctx.sequences.set(id, sequenceDefinition);
}
