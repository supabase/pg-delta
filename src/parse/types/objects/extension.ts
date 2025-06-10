import type { CreateExtensionStmt } from "@supabase/pg-parser/17/types";

export type ExtensionDefinition = {
  id: string;
  name: string;
  schema: string;
  statement: CreateExtensionStmt;
};
