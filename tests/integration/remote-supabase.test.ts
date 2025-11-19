import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { diffCatalogs } from "../../src/catalog.diff.ts";
import { extractCatalog } from "../../src/catalog.model.ts";
import type { MainOptions } from "../../src/main.ts";
import { postgresConfig } from "../../src/main.ts";
import { AlterRoleSetOptions } from "../../src/objects/role/changes/role.alter.ts";
import { sortChanges } from "../../src/sort/sort-changes.ts";
import { getTest } from "../utils.ts";

const test = getTest(17);

// Test to run manually.
// Don't forget to define the DATABASE_URL environment variable to connect to the remote Supabase instance.
test.skip("dump empty remote supabase into vanilla postgres", async ({
  db,
}) => {
  const { main } = db;

  // biome-ignore lint/style/noNonNullAssertion: DATABASE_URL is set in the environment
  const remote = postgres(process.env.DATABASE_URL!, postgresConfig);

  const [mainCatalog, branchCatalog] = await Promise.all([
    extractCatalog(main),
    extractCatalog(remote),
  ]);

  const changes = diffCatalogs(mainCatalog, branchCatalog);

  const options: MainOptions = {
    filter: (_context, change) => {
      // ALTER ROLE postgres WITH NOSUPERUSER;
      const isAlterRolePostgresWithNosuperuser =
        change instanceof AlterRoleSetOptions &&
        change.role.name === "postgres" &&
        change.options.includes("NOSUPERUSER");
      // Extensions that are not built-in are not supported
      const isExtension =
        change.objectType === "extension" &&
        change.extension.name !== '"uuid-ossp"';

      return !isAlterRolePostgresWithNosuperuser && !isExtension;
    },
  };

  let filteredChanges = options.filter
    ? changes.filter((change) =>
        // biome-ignore lint/style/noNonNullAssertion: options.filter is guaranteed to be defined
        options.filter!({ mainCatalog, branchCatalog }, change),
      )
    : changes;

  if (filteredChanges.length === 0) {
    return null;
  }

  // randomly sort the changes to test the logical sorting
  filteredChanges = filteredChanges.sort(() => {
    return Math.random() - 0.5;
  });

  const sortedChanges = sortChanges(
    { mainCatalog, branchCatalog },
    filteredChanges,
  );

  const hasRoutineChanges = sortedChanges.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate",
  );
  const sessionConfig = hasRoutineChanges
    ? ["SET check_function_bodies = false"]
    : [];

  const migrationScript = `${[
    ...sessionConfig,
    ...sortedChanges.map((change) => {
      return (
        options.serialize?.({ mainCatalog, branchCatalog }, change) ??
        change.serialize()
      );
    }),
  ].join(";\n\n")};`;

  const reportDir = join(__dirname, "diff-reports");
  await mkdir(reportDir, { recursive: true });

  try {
    await main.unsafe(migrationScript);
    // Save success report
    const successFilename = `success-dump-empty-remote-supabase-into-vanilla-postgres.md`;
    const successFilepath = join(reportDir, successFilename);
    const successContent = `
# Migration Success Report

## Migration Script

\`\`\`sql
${migrationScript}
\`\`\`
`;
    await writeFile(successFilepath, successContent);
  } catch (error) {
    // Save error report
    const errorFilename = `error-dump-empty-remote-supabase-into-vanilla-postgres.md`;
    const errorFilepath = join(reportDir, errorFilename);
    const errorContent = `
# Migration Error Report

## Error

\`\`\`
${error instanceof Error ? error.message : String(error)}
\`\`\`

## Migration Script

\`\`\`sql
${migrationScript}
\`\`\`
`;
    await writeFile(errorFilepath, errorContent);
    throw error;
  } finally {
    await remote.end();
  }
});
