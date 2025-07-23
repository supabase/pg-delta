import postgres from "postgres";
import { diffCatalogs } from "./catalog.diff.ts";
import { extractCatalog } from "./catalog.model.ts";

export async function main(mainDatabaseUrl: string, branchDatabaseUrl: string) {
  const mainSql = postgres(mainDatabaseUrl);
  const branchSql = postgres(branchDatabaseUrl);

  const [mainCatalog, branchCatalog] = await Promise.all([
    extractCatalog(mainSql),
    extractCatalog(branchSql),
  ]);

  await Promise.all([mainSql.end(), branchSql.end()]);

  const changes = diffCatalogs(mainCatalog, branchCatalog);

  const migrationScript = changes
    .map((change) => change.serialize())
    .join("\n\n");

  console.log(migrationScript);

  return migrationScript;
}
