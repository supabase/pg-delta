import postgres from "postgres";
import { diffCatalogs } from "./catalog.diff.ts";
import type { Catalog } from "./catalog.model.ts";
import { extractCatalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import { pgDumpSort } from "./sort/global-sort.ts";
import { applyRefinements } from "./sort/refined-sort.ts";
import { sortChangesByRules } from "./sort/sort-utils.ts";

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

export interface MainOptions {
  filter?: ChangeFilter;
  serialize?: ChangeSerializer;
}

export async function main(
  mainDatabaseUrl: string,
  branchDatabaseUrl: string,
  options: MainOptions = {},
) {
  const mainSql = postgres(mainDatabaseUrl, postgresConfig);
  const branchSql = postgres(branchDatabaseUrl, postgresConfig);

  const [mainCatalog, branchCatalog] = await Promise.all([
    extractCatalog(mainSql),
    extractCatalog(branchSql),
  ]);

  await Promise.all([mainSql.end(), branchSql.end()]);

  const changes = diffCatalogs(mainCatalog, branchCatalog);

  const globallySortedChanges = sortChangesByRules(changes, pgDumpSort);
  const refinedChanges = applyRefinements(
    { mainCatalog, branchCatalog },
    globallySortedChanges,
  );

  const filteredChanges = options.filter
    ? refinedChanges.filter((change) =>
        // biome-ignore lint/style/noNonNullAssertion: options.filter is guaranteed to be defined
        options.filter!({ mainCatalog, branchCatalog }, change),
      )
    : refinedChanges;

  if (filteredChanges.length === 0) {
    return null;
  }

  const hasProcedureChanges = filteredChanges.some(
    (change) => change.objectType === "procedure",
  );
  const sessionConfig = hasProcedureChanges
    ? ["SET check_function_bodies = false"]
    : [];

  const migrationScript = [
    ...sessionConfig,
    ...filteredChanges.map((change) => {
      return (
        options.serialize?.({ mainCatalog, branchCatalog }, change) ??
        change.serialize()
      );
    }),
  ].join(";\n\n");

  console.log(migrationScript);

  return migrationScript;
}
