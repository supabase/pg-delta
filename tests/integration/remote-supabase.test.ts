import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import dedent from "dedent";
import postgres from "postgres";
import { diffCatalogs } from "../../src/catalog.diff.ts";
import { extractCatalog } from "../../src/catalog.model.ts";
import type { Change } from "../../src/change.types.ts";
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
      return !isAlterRolePostgresWithNosuperuser;
    },
  };

  const filteredChanges = options.filter
    ? changes.filter((change) =>
        // biome-ignore lint/style/noNonNullAssertion: options.filter is guaranteed to be defined
        options.filter!({ mainCatalog, branchCatalog }, change),
      )
    : changes;

  if (filteredChanges.length === 0) {
    return null;
  }

  // force messages_inserted_at_topic_index index to be first in the list of changes before sorting
  let sortedChanges = filteredChanges.sort((a, b) => {
    const priority = (change: Change) => {
      if (
        change.objectType === "index" &&
        change.index.name === "messages_inserted_at_topic_index"
      ) {
        return 0;
      }
      return 1;
    };

    return priority(a) - priority(b);
  });

  sortedChanges = sortChanges({ mainCatalog, branchCatalog }, filteredChanges);

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

  try {
    await main.unsafe(migrationScript);
  } catch (error) {
    // save migration script and error to a file in markdown
    const errorDir = join(__dirname, "diff-reports");
    await mkdir(errorDir, { recursive: true });
    const filename = `dump-empty-remote-supabase-into-vanilla-postgres-error.md`;
    const filepath = join(errorDir, filename);
    const fileContent = dedent`
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
    await writeFile(filepath, fileContent);
    throw error;
  } finally {
    await remote.end();
  }
});
