import type {
  CreateFunctionStmt,
  RoleSpec,
} from "@supabase/pg-parser/17/types";

export type FunctionDefinition = {
  id: string;
  schema: string;
  name: string;
  owner?: RoleSpec;
  comment?: string;
  statement: CreateFunctionStmt;
};
