import type {
  AlterPublicationAddSchemas,
  AlterPublicationAddTables,
  AlterPublicationDropSchemas,
  AlterPublicationDropTables,
  AlterPublicationSetForAllTables,
  AlterPublicationSetList,
  AlterPublicationSetOptions,
  AlterPublicationSetOwner,
} from "./publication.alter.ts";
import type { CommentPublication } from "./publication.comment.ts";
import type { CreatePublication } from "./publication.create.ts";
import type { DropPublication } from "./publication.drop.ts";

export type PublicationChange =
  | AlterPublicationAddSchemas
  | AlterPublicationAddTables
  | AlterPublicationDropSchemas
  | AlterPublicationDropTables
  | AlterPublicationSetForAllTables
  | AlterPublicationSetList
  | AlterPublicationSetOptions
  | AlterPublicationSetOwner
  | CommentPublication
  | CreatePublication
  | DropPublication;
