import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { diffCatalogs } from "../../src/core/catalog.diff.ts";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import type { Change } from "../../src/core/change.types.ts";
import type { Integration } from "../../src/core/integrations/integration.types.ts";
import { AlterRoleSetOptions } from "../../src/core/objects/role/changes/role.alter.ts";
import { CreateRole } from "../../src/core/objects/role/changes/role.create.ts";
import {
  GrantRoleDefaultPrivileges,
  GrantRoleMembership,
  RevokeRoleDefaultPrivileges,
  RevokeRoleMembership,
} from "../../src/core/objects/role/changes/role.privilege.ts";
import { postgresConfig } from "../../src/core/postgres-config.ts";
import { sortChanges } from "../../src/core/sort/sort-changes.ts";
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

  const options: Integration = {
    filter: (change: Change) => {
      // ALTER ROLE postgres WITH NOSUPERUSER;
      const isAlterRolePostgresWithNosuperuser =
        change instanceof AlterRoleSetOptions &&
        change.role.name === "postgres" &&
        change.options.includes("NOSUPERUSER");
      // Extensions that are not built-in are not supported
      const isExtension =
        change.objectType === "extension" &&
        change.extension.name !== '"uuid-ossp"';
      const extensionRoleNames = [
        "pgsodium_keyiduser",
        "pgsodium_keyholder",
        "pgsodium_keymaker",
      ];
      // Filter out CREATE ROLE statements for extension roles
      const isCreateExtensionRole =
        change instanceof CreateRole &&
        extensionRoleNames.includes(change.role.name);
      // Filter out GRANT/REVOKE membership statements involving extension roles
      const isMembershipWithExtensionRole =
        (change instanceof GrantRoleMembership ||
          change instanceof RevokeRoleMembership) &&
        (extensionRoleNames.includes(change.role.name) ||
          extensionRoleNames.includes(change.member));
      // Filter out default privilege statements involving extension roles or extension schemas
      const extensionSchemaNames = ["pgsodium", "pgsodium_masks"];
      const isDefaultPrivilegeWithExtension =
        (change instanceof GrantRoleDefaultPrivileges ||
          change instanceof RevokeRoleDefaultPrivileges) &&
        (extensionRoleNames.includes(change.grantee) ||
          (change.inSchema !== null &&
            extensionSchemaNames.includes(change.inSchema)));

      return (
        !isAlterRolePostgresWithNosuperuser &&
        !isExtension &&
        !isCreateExtensionRole &&
        !isMembershipWithExtensionRole &&
        !isDefaultPrivilegeWithExtension
      );
    },
  };

  let filteredChanges = options.filter
    ? changes.filter((change) =>
        // biome-ignore lint/style/noNonNullAssertion: options.filter is guaranteed to be defined
        options.filter!(change),
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
      return options.serialize?.(change) ?? change.serialize();
    }),
  ].join(";\n\n")};`;

  const reportDir = join(__dirname, "diff-reports");
  await mkdir(reportDir, { recursive: true });

  try {
    await main.unsafe(migrationScript);

    // Verify that the migration was successful by diffing again
    const [mainCatalogAfter, branchCatalogAfter] = await Promise.all([
      extractCatalog(main),
      extractCatalog(remote),
    ]);

    const changesAfter = diffCatalogs(mainCatalogAfter, branchCatalogAfter);

    const filteredChangesAfter = options.filter
      ? changesAfter.filter((change) =>
          // biome-ignore lint/style/noNonNullAssertion: options.filter is guaranteed to be defined
          options.filter!(change),
        )
      : changesAfter;

    // Verify that there are no remaining changes
    if (filteredChangesAfter.length > 0) {
      // Generate second migration script for remaining changes
      const sortedChangesAfter = sortChanges(
        { mainCatalog: mainCatalogAfter, branchCatalog: branchCatalogAfter },
        filteredChangesAfter,
      );

      const hasRoutineChangesAfter = sortedChangesAfter.some(
        (change) =>
          change.objectType === "procedure" ||
          change.objectType === "aggregate",
      );
      const sessionConfigAfter = hasRoutineChangesAfter
        ? ["SET check_function_bodies = false"]
        : [];

      const secondMigrationScript = `${[
        ...sessionConfigAfter,
        ...sortedChangesAfter.map((change) => {
          return options.serialize?.(change) ?? change.serialize();
        }),
      ].join(";\n\n")};`;

      // Save error report with both migration scripts
      const errorFilename = `error-dump-empty-remote-supabase-into-vanilla-postgres.md`;
      const errorFilepath = join(reportDir, errorFilename);
      const errorContent = `
# Migration Error Report

## Error

\`\`\`
Migration verification failed: Found ${filteredChangesAfter.length} remaining changes after migration
\`\`\`

## First Migration Script

\`\`\`sql
${migrationScript}
\`\`\`

## Second Migration Script (Remaining Changes)

\`\`\`sql
${secondMigrationScript}
\`\`\`
`;
      await writeFile(errorFilepath, errorContent);

      throw new Error(
        `Migration verification failed: Found ${filteredChangesAfter.length} remaining changes after migration`,
      );
    }

    // Save success report
    const successFilename = `success-dump-empty-remote-supabase-into-vanilla-postgres.md`;
    const successFilepath = join(reportDir, successFilename);
    const successContent = `
# Migration Success Report

## Migration Script

\`\`\`sql
${migrationScript}
\`\`\`

## Verification

After running the migration, the databases were diffed again and verified to have no remaining changes.
`;
    await writeFile(successFilepath, successContent);
  } catch (error) {
    // Only save error report if it hasn't been saved already (i.e., migration execution failed)
    if (
      error instanceof Error &&
      !error.message.includes("Migration verification failed")
    ) {
      // Save error report
      const errorFilename = `error-dump-empty-remote-supabase-into-vanilla-postgres.md`;
      const errorFilepath = join(reportDir, errorFilename);
      const errorContent = `
# Migration Error Report

## Error

\`\`\`
${error.message}
\`\`\`

## First Migration Script

\`\`\`sql
${migrationScript}
\`\`\`
`;
      await writeFile(errorFilepath, errorContent);
    }
    throw error;
  } finally {
    await remote.end();
  }
});
