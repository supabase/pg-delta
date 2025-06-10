import type {
  CompositeTypeStmt,
  CreateEnumStmt,
  CreateRangeStmt,
  RoleSpec,
} from "@supabase/pg-parser/17/types";

export type TypeKind = "enum" | "composite" | "range" | "domain";

export type TypeDefinition = {
  id: string;
  schema: string;
  name: string;
  kind: TypeKind;
  statement: CreateEnumStmt | CompositeTypeStmt | CreateRangeStmt;
  owner?: RoleSpec;
  comment?: string;
};
