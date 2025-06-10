import type { ColumnDef, Constraint } from "@supabase/pg-parser/17/types";

export type TableDefinition = {
  id: string;
  schema: string;
  name: string;
  columns: ColumnDef[];
  constraints: Constraint[];
};
