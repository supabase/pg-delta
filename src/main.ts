import postgres from "postgres";
import { diffCatalogs } from "./catalog.diff.ts";
import { extractCatalog } from "./catalog.model.ts";
import { resolveDependencies } from "./dependency.ts";

export async function main(mainDatabaseUrl: string, branchDatabaseUrl: string) {
  const mainSql = postgres(mainDatabaseUrl);
  const branchSql = postgres(branchDatabaseUrl);

  const [mainCatalog, branchCatalog] = await Promise.all([
    extractCatalog(mainSql),
    extractCatalog(branchSql),
  ]);

  await Promise.all([mainSql.end(), branchSql.end()]);

  const changes = diffCatalogs(mainCatalog, branchCatalog);

  // Order the changes to satisfy dependencies constraints between objects
  const sortedChanges = resolveDependencies(
    changes,
    mainCatalog,
    branchCatalog,
  );

  if (sortedChanges.isErr()) {
    throw sortedChanges.error;
  }

  const migrationScript = sortedChanges.value
    .map((change) => change.serialize())
    .join("\n\n");

  console.log(migrationScript);

  return migrationScript;
}
