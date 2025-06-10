import type { RoleSpec } from "@supabase/pg-parser/17/types";

export type IndexDefinition = {
  id: string;
  schema: string;
  name: string;
  owner?: RoleSpec;
  comment?: string;
  // statement: CreateIndexStmt;
};
