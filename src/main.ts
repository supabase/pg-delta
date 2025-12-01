import postgres from "postgres";
import { diffCatalogs } from "./catalog.diff.ts";
import type { Catalog } from "./catalog.model.ts";
import { extractCatalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import { base } from "./integrations/base.ts";
import type { Integration } from "./integrations/integration.types.ts";
import { sortChanges } from "./sort/sort-changes.ts";

// Custom type handler for specifics corner cases
export const postgresConfig: postgres.Options<
  Record<string, postgres.PostgresType>
> = {
  types: {
    int2vector: {
      // The pg_types oid for int2vector (22 is the OID for int2vector)
      to: 22,
      // Array of pg_types oids to handle when parsing values coming from the db
      from: [22],
      // Parse int2vector from string format "1 2 3" to array [1, 2, 3]
      parse: (value: string) => {
        if (!value || value === "") return [];
        return value
          .split(" ")
          .map(Number)
          .filter((n) => !Number.isNaN(n));
      },
      // Serialize array back to int2vector format if needed
      serialize: (value: number[]) => {
        if (!Array.isArray(value)) return "";
        return value.join(" ");
      },
    },
    // Handle bigint values from PostgreSQL
    bigint: {
      // The pg_types oid for bigint (20 is the OID for int8/bigint)
      to: 20,
      // Array of pg_types oids to handle when parsing values coming from the db
      from: [20],
      // Parse bigint string to JavaScript BigInt
      parse: (value: string) => {
        return BigInt(value);
      },
      // Serialize BigInt back to string for PostgreSQL
      serialize: (value: bigint) => {
        return value.toString();
      },
    },
  },
};

export interface DiffContext {
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}

export type ChangeFilter = (ctx: DiffContext, change: Change) => boolean;

export type ChangeSerializer = (
  ctx: DiffContext,
  change: Change,
) => string | undefined;

export type MainOptions = Integration;

export interface DiffResult {
  migrationScript: string;
}

export async function main(
  mainDatabaseUrl: string,
  branchDatabaseUrl: string,
  options: MainOptions = {},
): Promise<DiffResult | null> {
  const mainSql = postgres(mainDatabaseUrl, postgresConfig);
  const branchSql = postgres(branchDatabaseUrl, postgresConfig);

  const [mainCatalog, branchCatalog] = await Promise.all([
    extractCatalog(mainSql),
    extractCatalog(branchSql),
  ]);

  await Promise.all([mainSql.end(), branchSql.end()]);

  const changes = diffCatalogs(mainCatalog, branchCatalog);

  // Use provided options as integration, or fall back to safe default
  const integration = options ?? base;

  // Apply filter if provided
  const ctx = { mainCatalog, branchCatalog };
  let filteredChanges = changes;

  const integrationFilter = integration.filter;
  if (integrationFilter) {
    filteredChanges = filteredChanges.filter((change) =>
      integrationFilter(ctx, change),
    );
  }

  if (filteredChanges.length === 0) {
    return null;
  }

  const sortedChanges = sortChanges(ctx, filteredChanges);

  const hasRoutineChanges = sortedChanges.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate",
  );
  const sessionConfig = hasRoutineChanges
    ? ["SET check_function_bodies = false"]
    : [];

  // Build migration script
  const scriptParts: string[] = [];
  scriptParts.push(...sessionConfig);

  // Serialize changes using integration serialize hook (applies masking) or fallback
  const changeStatements = sortedChanges.map((change) => {
    return integration.serialize?.(ctx, change) ?? change.serialize();
  });

  scriptParts.push(...changeStatements);

  const migrationScript = `${scriptParts.join(";\n\n")};`;

  console.log(migrationScript);

  return {
    migrationScript,
  };
}
