import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { describe, expect, test } from "vitest";
import { diffCatalogs } from "../../src/catalog.diff.ts";
import { type Catalog, extractCatalog } from "../../src/catalog.model.ts";
import { postgresConfig } from "../../src/main.ts";
import { stringifyWithBigInt } from "../../src/objects/utils.ts";
import { pgDumpSort } from "../../src/sort/global-sort.ts";
import { applyRefinements } from "../../src/sort/refined-sort.ts";
import { sortChangesByRules } from "../../src/sort/sort-utils.ts";
import {
  type StartedSupabasePostgreSqlContainer,
  SupabasePostgreSqlContainer,
} from "../supabase-postgres.ts";
import { supabaseFilter } from "./supabase-filter.ts";

interface ProjectData {
  ref: string;
  connection_strings: {
    supabase_admin: string;
    postgres: string;
    auth: string;
    storage: string;
    pgbouncer: string;
    etl: string;
    postgrest: string;
    replication: string;
  };
  connection_valid: boolean;
  postgres_major_version: number;
  postgres_image_version: string;
  migrations_schema_exists: boolean;
  migrations_table_exists: boolean;
  migrations: Migration[];
  error?: string;
}

interface Migration {
  version: string;
  statements: string[];
  name: string;
}

interface TestResult {
  projectRef: string;
  success: boolean;
  error?: string;
  issues: Issue[];
  testType: "no-migrations" | "with-migrations";
}

interface Issue {
  type:
    | "invalid-sql"
    | "remaining-diff"
    | "catalog-extraction-error"
    | "connection-error"
    | "dependency-resolution-error";
  description: string;
  details: {
    projectRef: string;
    postgresVersion: string;
    migrationName?: string;
    allMigrations?: string[];
    sqlScript?: string;
    errorMessage?: string;
    remainingChanges?: string[];
  };
}

class RealProjectRoundtripTester {
  private issueCounter = new Map<string, number>();

  async testProject(project: ProjectData): Promise<TestResult> {
    const hasMigrations = project.migrations.length > 0;
    const issues: Issue[] = [];
    const testType = hasMigrations ? "with-migrations" : "no-migrations";

    // Setup containers based on test type
    const supabaseImage = `supabase/postgres:${project.postgres_image_version}`;

    let sourceContainer: StartedSupabasePostgreSqlContainer | null = null;
    let testContainer: StartedSupabasePostgreSqlContainer | null = null;
    let remoteSql: postgres.Sql | null = null;

    try {
      if (hasMigrations) {
        // With migrations: start two fresh containers
        [sourceContainer, testContainer] = await Promise.all([
          new SupabasePostgreSqlContainer(supabaseImage).start(),
          new SupabasePostgreSqlContainer(supabaseImage).start(),
        ]);
      } else {
        // No migrations: connect to remote + start one container
        const rawPostgresUrl = project.connection_strings.postgres;
        const encodedPostgresUrl = rawPostgresUrl.replace(
          /postgresql:\/\/postgres:(.+)@db\./,
          (_match, password) =>
            `postgresql://postgres:${encodeURIComponent(password)}@db.`,
        );
        remoteSql = postgres(encodedPostgresUrl, postgresConfig);
        sourceContainer = await new SupabasePostgreSqlContainer(
          supabaseImage,
        ).start();
      }

      const sourceSql = postgres(
        sourceContainer.getConnectionUri(),
        postgresConfig,
      );
      const testSql = testContainer
        ? postgres(testContainer.getConnectionUri(), postgresConfig)
        : null;

      try {
        return await this.testWorkflow(
          project,
          sourceSql,
          testSql,
          remoteSql,
          issues,
          testType,
        );
      } finally {
        await Promise.all([sourceSql.end(), testSql?.end()]);
      }
    } finally {
      await Promise.all([
        sourceContainer?.stop(),
        testContainer?.stop(),
        remoteSql?.end(),
      ]);
    }
  }

  private async testWorkflow(
    project: ProjectData,
    sourceSql: postgres.Sql,
    testSql: postgres.Sql | null,
    remoteSql: postgres.Sql | null,
    issues: Issue[],
    testType: "no-migrations" | "with-migrations",
  ): Promise<TestResult> {
    const hasMigrations = testType === "with-migrations";
    let migrationScript: string | null = null;

    try {
      if (hasMigrations) {
        // With migrations: apply migrations step by step
        for (let i = 0; i < project.migrations.length; i++) {
          const migration = project.migrations[i];
          const migrationSql = migration.statements.join(";\n");

          // Apply migration to source database
          await this.executeMigrationScript(
            sourceSql,
            migrationSql,
            project,
            issues,
            `Migration ${migration.name} failed to apply`,
            migration.name,
          );

          if (issues.length > 0) {
            return {
              projectRef: project.ref,
              success: false,
              issues,
              testType,
            };
          }

          // Extract catalogs and generate diff
          if (!testSql) {
            throw new Error(
              "Test SQL connection not available for migrations test",
            );
          }
          const [sourceCatalog, testCatalog] = await Promise.all([
            extractCatalog(sourceSql),
            extractCatalog(testSql),
          ]);

          const migrationScript = generateMigrationScript(
            sourceCatalog,
            testCatalog,
          );

          if (!migrationScript) {
            continue; // No changes needed for this migration
          }

          // Apply diff to test container
          await this.executeMigrationScript(
            testSql,
            migrationScript,
            project,
            issues,
            `Generated diff for migration ${migration.name} failed to execute`,
            migration.name,
          );

          if (issues.length > 0) {
            return {
              projectRef: project.ref,
              success: false,
              issues,
              testType,
            };
          }

          // Verify no remaining differences
          const testCatalogAfter = await extractCatalog(testSql);
          const remainingChanges = diffCatalogs(
            testCatalogAfter,
            sourceCatalog,
          );
          const remainingChangesFiltered = supabaseFilter(
            { mainCatalog: testCatalogAfter, branchCatalog: sourceCatalog },
            remainingChanges,
          );
          if (remainingChangesFiltered.length > 0) {
            issues.push({
              type: "remaining-diff",
              description: `After applying diff for migration ${migration.name}, ${remainingChangesFiltered.length} differences remain`,
              details: {
                projectRef: project.ref,
                postgresVersion: project.postgres_image_version,
                migrationName: migration.name,
                allMigrations: project.migrations.map((m) => m.name),
                sqlScript: migrationScript,
                remainingChanges: remainingChangesFiltered.map((change) =>
                  change.serialize(),
                ),
              },
            });
          }
        }

        // Final check against remote database
        if (!remoteSql) {
          throw new Error(
            "Remote SQL connection not available for final check",
          );
        }
        const [finalSourceCatalog, remoteCatalog] = await Promise.all([
          extractCatalog(sourceSql),
          extractCatalog(remoteSql),
        ]);

        const finalMigrationScript = generateMigrationScript(
          finalSourceCatalog,
          remoteCatalog,
        );

        if (!finalMigrationScript) {
          return {
            projectRef: project.ref,
            success: true,
            issues,
            testType,
          };
        }

        await this.executeMigrationScript(
          sourceSql,
          finalMigrationScript,
          project,
          issues,
          "Final diff script failed to execute",
        );

        return {
          projectRef: project.ref,
          success: issues.length === 0,
          issues,
          testType,
        };
      } else {
        // No migrations: single migration operation
        if (!remoteSql) {
          throw new Error(
            "Remote SQL connection not available for no-migrations test",
          );
        }
        const [localCatalog, remoteCatalog] = await Promise.all([
          extractCatalog(sourceSql),
          extractCatalog(remoteSql),
        ]);

        // Generate and apply migration
        migrationScript = generateMigrationScript(localCatalog, remoteCatalog);

        if (!migrationScript) {
          return {
            projectRef: project.ref,
            success: true,
            issues,
            testType,
          };
        }

        await this.executeMigrationScript(
          sourceSql,
          migrationScript,
          project,
          issues,
          "Generated SQL failed to execute",
        );

        if (issues.length > 0) {
          return {
            projectRef: project.ref,
            success: false,
            issues,
            testType,
          };
        }

        // Verify no remaining differences
        const localCatalogAfter = await extractCatalog(sourceSql);
        const remainingChanges = diffCatalogs(localCatalogAfter, remoteCatalog);
        const remainingChangesFiltered = supabaseFilter(
          { mainCatalog: localCatalogAfter, branchCatalog: remoteCatalog },
          remainingChanges,
        );

        if (remainingChangesFiltered.length > 0) {
          issues.push({
            type: "remaining-diff",
            description: `After applying migration, ${remainingChangesFiltered.length} differences remain`,
            details: {
              projectRef: project.ref,
              postgresVersion: project.postgres_image_version,
              sqlScript: migrationScript,
              remainingChanges: remainingChangesFiltered.map((change) =>
                change.serialize(),
              ),
            },
          });
        }

        return {
          projectRef: project.ref,
          success: remainingChangesFiltered.length === 0,
          issues,
          testType,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      issues.push({
        type: "catalog-extraction-error",
        description: `Failed to extract catalog: ${errorMessage}`,
        details: {
          projectRef: project.ref,
          postgresVersion: project.postgres_image_version,
          errorMessage,
          sqlScript: migrationScript ?? "",
        },
      });

      return {
        projectRef: project.ref,
        success: false,
        issues,
        testType,
      };
    }
  }

  private async executeMigrationScript(
    sql: postgres.Sql,
    script: string,
    project: ProjectData,
    issues: Issue[],
    errorDescription: string,
    migrationName?: string,
  ): Promise<void> {
    try {
      await sql.unsafe(script);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      issues.push({
        type: "invalid-sql",
        description: `${errorDescription}: ${errorMessage}`,
        details: {
          projectRef: project.ref,
          postgresVersion: project.postgres_image_version,
          migrationName,
          allMigrations: project.migrations.map((m) => m.name),
          sqlScript: script,
          errorMessage,
        },
      });
    }
  }

  async generateIssueFiles(result: TestResult): Promise<void> {
    const issuesDir = join(
      process.cwd(),
      "diff-issues",
      "staging",
      `project-${result.projectRef}`,
    );
    await mkdir(issuesDir, { recursive: true });

    for (const issue of result.issues) {
      const issueNumber = this.getNextIssueNumber(result.projectRef);
      const filename = `issue${issueNumber}.md`;
      const filepath = join(issuesDir, filename);

      const content = this.generateIssueMarkdown(issue, result);
      await writeFile(filepath, content, "utf-8");
    }
  }

  private getNextIssueNumber(projectRef: string): number {
    const current = this.issueCounter.get(projectRef) || 0;
    const next = current + 1;
    this.issueCounter.set(projectRef, next);
    return next;
  }

  private generateIssueMarkdown(issue: Issue, result: TestResult): string {
    const { details } = issue;

    return `# ${issue.type.toUpperCase()}: ${issue.description}

## Project Information
- **Project Ref**: ${details.projectRef}
- **PostgreSQL Version**: ${details.postgresVersion}
- **Test Type**: ${result.testType}

${
  details.migrationName
    ? `## Migration Information
- **Migration Name**: ${details.migrationName}
- **All Migrations**: ${details.allMigrations?.map((m) => `\`${m}\``).join(", ") || "None"}
`
    : ""
}

## Issue Details
${issue.description}

${
  details.errorMessage
    ? `## Error Message
\`\`\`
${details.errorMessage}
\`\`\`
`
    : ""
}

${
  details.sqlScript
    ? `## SQL Script
\`\`\`sql
${details.sqlScript}
\`\`\`
`
    : ""
}

${
  details.remainingChanges
    ? `## Remaining Changes
${details.remainingChanges
  .map(
    (change, i) => `### Change ${i + 1}
\`\`\`sql
${change}
\`\`\`
`,
  )
  .join("\n")}
`
    : ""
}

## Reproduction Steps
1. Connect to project \`${details.projectRef}\`
2. ${
      result.testType === "with-migrations"
        ? `Apply migrations: ${details.allMigrations?.join(" → ") || "N/A"}`
        : "Compare with fresh Supabase container"
    }
3. Generate and apply diff
4. Verify remaining changes

---
*Generated on ${new Date().toISOString()}*
`;
  }
}

// Load project data once at module level
let projectsData: ProjectData[] | null = null;

async function loadProjectsData(): Promise<ProjectData[]> {
  if (projectsData === null) {
    projectsData = JSON.parse(
      await readFile("database-extraction-results.json", "utf-8"),
    ) as ProjectData[];
  }
  return projectsData;
}

// Generate individual vitest tests for each project
describe("Real Project Roundtrip Tests", async () => {
  let projects = await loadProjectsData();

  // Take only the first 10 projects
  projects = projects.slice(0, 1);

  // projects = projects.filter((p) => p.ref === "firmdujfeupgocnckibm");

  for (const project of projects) {
    const testName = `project-${project.ref}-roundtrip`;

    test(testName, async () => {
      const tester = new RealProjectRoundtripTester();
      const result = await tester.testProject(project);

      // Generate issue files if there are issues
      if (result.issues.length > 0) {
        await tester.generateIssueFiles(result);
      }

      // Assert test success
      expect(result.success).toBe(true);
    });
  }
});

function generateMigrationScript(mainCatalog: Catalog, branchCatalog: Catalog) {
  const changes = diffCatalogs(mainCatalog, branchCatalog);
  if (process.env.DEBUG) {
    console.log("branchCatalog.extensions: ");
    console.log(stringifyWithBigInt(branchCatalog.extensions, 2));
    console.log("mainCatalog.extensions: ");
    console.log(stringifyWithBigInt(mainCatalog.extensions, 2));
  }
  if (changes.length === 0) {
    // No changes needed - remote is same as fresh Supabase
    return null;
  }

  // Global sort
  const globallySortedChanges = sortChangesByRules(changes, pgDumpSort);

  // Refined sort
  const sortedChanges = applyRefinements(
    { mainCatalog, branchCatalog },
    globallySortedChanges,
  );

  // Custom filter
  const filteredChanges = supabaseFilter(
    { mainCatalog, branchCatalog },
    sortedChanges,
  );

  // Generate migration SQL
  const sessionConfig = ["SET check_function_bodies = false"];

  return [
    ...sessionConfig,
    ...filteredChanges.map((change) => change.serialize()),
  ]
    .join(";\n\n")
    .trim();
}
