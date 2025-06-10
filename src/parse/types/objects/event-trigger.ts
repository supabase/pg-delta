import type {
  CreateEventTrigStmt,
  RoleSpec,
} from "@supabase/pg-parser/17/types";

export type EventTriggerDefinition = {
  id: string;
  name: string;
  owner?: RoleSpec;
  comment?: string;
  statement: CreateEventTrigStmt;
};
