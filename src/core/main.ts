import postgres from "postgres";
import { diffCatalogs } from "./catalog.diff.ts";
import { extractCatalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import type { DiffContext } from "./context.ts";
import { base } from "./integrations/base.ts";
import type { Integration } from "./integrations/integration.types.ts";
import { postgresConfig } from "./postgres-config.ts";
import { sortChanges } from "./sort/sort-changes.ts";

// Re-export for backwards compatibility
export type { DiffContext } from "./context.ts";
export { postgresConfig } from "./postgres-config.ts";

export type ChangeFilter = (ctx: DiffContext, change: Change) => boolean;

export type ChangeSerializer = (
  ctx: DiffContext,
  change: Change,
) => string | undefined;

export type MainOptions = Integration;

interface DiffResult {
  migrationScript: string;
}

async function _main(
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

  return {
    migrationScript,
  };
}
