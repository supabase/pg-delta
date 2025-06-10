import type {
  ColumnDef,
  Constraint,
  RoleSpec,
} from "@supabase/pg-parser/17/types";

export type TableDefinition = {
  id: string;
  schema: string;
  name: string;
  owner?: RoleSpec;
  columns: ColumnDef[];
  constraints: Constraint[];
};
