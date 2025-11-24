import type { AlterUserMapping } from "./user-mapping.alter.ts";
import type { CreateUserMapping } from "./user-mapping.create.ts";
import type { DropUserMapping } from "./user-mapping.drop.ts";

export type UserMappingChange =
  | AlterUserMapping
  | CreateUserMapping
  | DropUserMapping;
