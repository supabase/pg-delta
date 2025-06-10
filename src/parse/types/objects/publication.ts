import type {
  CreatePublicationStmt,
  RoleSpec,
} from "@supabase/pg-parser/17/types";

export type PublicationDefinition = {
  id: string;
  name: string;
  owner?: RoleSpec;
  comment?: string;
  statement: CreatePublicationStmt;
};
