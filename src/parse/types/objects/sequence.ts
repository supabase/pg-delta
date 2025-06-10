import type { CreateSeqStmt, RoleSpec } from "@supabase/pg-parser/17/types";

export type SequenceDefinition = {
  id: string;
  schema: string;
  name: string;
  owner?: RoleSpec;
  comment?: string;
  statement: CreateSeqStmt;
};
