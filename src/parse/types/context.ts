import type { EventTriggerDefinition } from "./objects/event-trigger.ts";
import type { ExtensionDefinition } from "./objects/extension.ts";
import type { FunctionDefinition } from "./objects/function.ts";
import type { PublicationDefinition } from "./objects/publication.ts";
import type { SchemaDefinition } from "./objects/schema.ts";
import type { TableDefinition } from "./objects/table.ts";
import type { TypeDefinition } from "./objects/type.ts";

export type ParseContext = {
  eventTriggers: Map<string, EventTriggerDefinition>;
  extensions: Map<string, ExtensionDefinition>;
  functions: Map<string, FunctionDefinition>;
  publications: Map<string, PublicationDefinition>;
  schemas: Map<string, SchemaDefinition>;
  tables: Map<string, TableDefinition>;
  types: Map<string, TypeDefinition>;
};
