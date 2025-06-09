import type {
  ColumnDef,
  CompositeTypeStmt,
  Constraint,
  CreateEnumStmt,
  CreateExtensionStmt,
  CreateFunctionStmt,
  CreateRangeStmt,
  CreateSchemaStmt,
  RoleSpec,
} from "@supabase/pg-parser/17/types";

export type ExtensionDefinition = {
  id: string;
  name: string;
  schema: string;
  statement: CreateExtensionStmt;
};

export type TableDefinition = {
  id: string;
  schema: string;
  name: string;
  columns: ColumnDef[];
  constraints: Constraint[];
};

type TypeKind = "enum" | "composite" | "range" | "domain";

export type TypeDefinition = {
  id: string;
  schema: string;
  name: string;
  kind: TypeKind;
  statement: CreateEnumStmt | CompositeTypeStmt | CreateRangeStmt;
  owner?: RoleSpec;
  comment?: string;
};

export type FunctionDefinition = {
  id: string;
  schema: string;
  name: string;
  owner?: RoleSpec;
  comment?: string;
  statement: CreateFunctionStmt;
};

export type ParseContext = {
  extensions: Map<string, ExtensionDefinition>;
  functions: Map<string, FunctionDefinition>;
  schemas: Map<string, CreateSchemaStmt>;
  tables: Map<string, TableDefinition>;
  types: Map<string, TypeDefinition>;
};
