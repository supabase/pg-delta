import type { CreatePublicationStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types/context.ts";
import type { PublicationDefinition } from "../types/objects/publication.ts";

export function handleCreatePublicationStmt(
  ctx: ParseContext,
  node: CreatePublicationStmt,
) {
  if (!node.pubname) return;

  const publicationDefinition: PublicationDefinition = {
    id: node.pubname,
    name: node.pubname,
    statement: node,
  };

  ctx.publications.set(node.pubname, publicationDefinition);
}
