import type { PGClient } from "../types.ts";
import {
  extractSequenceDefinitions,
  type SequenceDefinition,
  serializeSequenceDefinitions,
} from "./sequences.ts";
import {
  extractTableDefinitions,
  serializeTableDefinitions,
  type TableDefinition,
} from "./tables.ts";

export type Definitions = {
  sequences: SequenceDefinition[];
  tables: TableDefinition[];
};

export async function extractDefinitions(db: PGClient) {
  const sequences = await extractSequenceDefinitions(db);
  const tables = await extractTableDefinitions(db);
  return {
    sequences,
    tables,
  };
}

export function serializeDefinitions(definitions: Definitions) {
  const statements = [];
  statements.push(serializeSequenceDefinitions(definitions.sequences));
  statements.push(serializeTableDefinitions(definitions.tables));
  return statements.join(";\n\n");
}
