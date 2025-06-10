import type { CreateSchemaStmt, RoleSpec } from "@supabase/pg-parser/17/types";

export type SchemaDefinition = {
  id: string;
  name: string;
  statement: CreateSchemaStmt;
  owner?: RoleSpec;
};
