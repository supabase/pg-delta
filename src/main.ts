import postgres from "postgres";
import { diffCatalogs } from "./catalog.diff.ts";
import { extractCatalog } from "./catalog.model.ts";
import { resolveDependencies } from "./dependency.ts";

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
          .filter((n) => !isNaN(n));
      },
      // Serialize array back to int2vector format if needed
      serialize: (value: number[]) => {
        if (!Array.isArray(value)) return "";
        return value.join(" ");
      },
    },
  },
};

export async function main(mainDatabaseUrl: string, branchDatabaseUrl: string) {
  const mainSql = postgres(mainDatabaseUrl, postgresConfig);
  const branchSql = postgres(branchDatabaseUrl, postgresConfig);

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
