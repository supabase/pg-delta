import type { PGClient } from "../types.ts";
import { extractDefinitions } from "./extract.ts";
import { serializeSchemaDiff } from "./serialize.ts";
import type {
  DatabaseDefinition,
  DiffInput,
  DiffOperation,
  SchemaDiff,
} from "./types.ts";

export function computeDiff<T extends { id: string }>(
  source: T[] | undefined,
  target: T[],
): DiffOperation<T>[] {
  const operations: DiffOperation<T>[] = [];
  const sourceMap = source
    ? new Map(source.map((obj) => [obj.id, obj]))
    : new Map();
  const targetMap = new Map(target.map((obj) => [obj.id, obj]));

  // If source is undefined, everything in target is a create operation
  if (!source) {
    return target.map((obj) => ({
      type: "create",
      object: obj,
    }));
  }

  // Find created and modified objects
  for (const [id, targetObj] of targetMap) {
    const sourceObj = sourceMap.get(id);
    if (!sourceObj) {
      operations.push({
        type: "create",
        object: targetObj,
      });
      continue;
    }

    // Compare properties
    const changes = [];
    for (const key of Object.keys(targetObj) as Array<keyof T>) {
      if (key === "id") continue; // Skip id as it's our identifier
      if (JSON.stringify(targetObj[key]) !== JSON.stringify(sourceObj[key])) {
        changes.push({
          property: key,
          oldValue: sourceObj[key],
          newValue: targetObj[key],
        });
      }
    }

    if (changes.length > 0) {
      operations.push({
        type: "alter",
        object: targetObj,
        changes,
      });
    }
  }

  // Find dropped objects (only if we have a source)
  for (const [id, sourceObj] of sourceMap) {
    if (!targetMap.has(id)) {
      operations.push({
        type: "drop",
        object: sourceObj,
      });
    }
  }

  return operations;
}

export function computeSchemaDiff(input: DiffInput): SchemaDiff {
  return {
    tables: computeDiff(input.source?.tables, input.target.tables),
    sequences: computeDiff(input.source?.sequences, input.target.sequences),
  };
}

export function computeSchemaDump(db: DatabaseDefinition): SchemaDiff {
  return computeSchemaDiff({ target: db });
}

export type MigrationResult = {
  sql: string;
  diff: SchemaDiff;
};

/**
 * Generates a migration SQL script by comparing two database states.
 * This is a convenience function that combines extracting definitions,
 * computing the diff, and serializing it into SQL.
 *
 * @param sourceDb - The source database client (current state)
 * @param targetDb - The target database client (desired state)
 * @returns The migration SQL and the computed diff
 */
export async function generateMigration(
  sourceDb: PGClient,
  targetDb: PGClient,
): Promise<MigrationResult> {
  const sourceDefinitions = await extractDefinitions(sourceDb);
  const targetDefinitions = await extractDefinitions(targetDb);

  const diff = computeSchemaDiff({
    source: sourceDefinitions,
    target: targetDefinitions,
  });

  const sql = serializeSchemaDiff(diff);

  return {
    sql,
    diff,
  };
}
