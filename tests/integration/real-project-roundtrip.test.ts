import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { test } from "vitest";
import { diffCatalogs } from "../../src/catalog.diff.ts";
import { type Catalog, extractCatalog } from "../../src/catalog.model.ts";
import { postgresConfig } from "../../src/main.ts";
import { pgDumpSort } from "../../src/sort/global-sort.ts";
import { applyRefinements } from "../../src/sort/refined-sort.ts";
import { sortChangesByRules } from "../../src/sort/sort-utils.ts";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  type PostgresVersion,
} from "../constants.ts";
import { SupabasePostgreSqlContainer } from "../supabase-postgres.ts";
import { catalogsSemanticalyEqual } from "./roundtrip.ts";
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
    postgresVersion: number;
    migrationName?: string;
    allMigrations?: string[];
    sqlScript?: string;
    errorMessage?: string;
    remainingChanges?: string[];
  };
}

class RealProjectRoundtripTester {
  private issueCounter = new Map<string, number>();

  async runTests(
    projects: ProjectData[],
    maxProjects = 10,
  ): Promise<TestResult[]> {
    console.log(
      `Starting roundtrip tests for ${Math.min(projects.length, maxProjects)} projects...`,
    );

    const validProjects = projects
      .filter((p) => p.connection_valid)
      .slice(0, maxProjects);

    const results: TestResult[] = [];

    for (const project of validProjects) {
      console.log(
        `\nTesting project: ${project.ref} (PostgreSQL ${project.postgres_major_version})`,
      );

      try {
        const result = await this.testProject(project);
        results.push(result);

        if (result.issues.length > 0) {
          await this.generateIssueFiles(result);
        }

        console.log(
          `  ${result.success ? "✅" : "❌"} Project ${project.ref}: ${result.success ? "PASSED" : "FAILED"} (${result.issues.length} issues)`,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.log(`  ❌ Project ${project.ref}: CRASHED - ${errorMessage}`);

        const result: TestResult = {
          projectRef: project.ref,
          success: false,
          error: errorMessage,
          issues: [
            {
              type: "connection-error",
              description: `Failed to test project: ${errorMessage}`,
              details: {
                projectRef: project.ref,
                postgresVersion: project.postgres_major_version,
                errorMessage,
              },
            },
          ],
          testType:
            project.migrations.length > 0 ? "with-migrations" : "no-migrations",
        };

        results.push(result);
        await this.generateIssueFiles(result);
      }
    }

    return results;
  }

  private async testProject(project: ProjectData): Promise<TestResult> {
    const hasMigrations = project.migrations.length > 0;

    if (hasMigrations) {
      return await this.testProjectWithMigrations(project);
    } else {
      return await this.testProjectWithoutMigrations(project);
    }
  }

  private async testProjectWithoutMigrations(
    project: ProjectData,
  ): Promise<TestResult> {
    const issues: Issue[] = [];

    // Connect to remote project
    let migrationScript: string | null = null;
    console.log(project.connection_strings);
    const remoteSql = postgres(
      project.connection_strings.postgres,
      postgresConfig,
    );
    console.log("ALIVE");
    try {
      // Extract remote catalog
      const remoteCatalog = await extractCatalog(remoteSql);

      // Start fresh Supabase container with matching version
      const supabaseImage = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[project.postgres_major_version as PostgresVersion]}`;
      const container = new SupabasePostgreSqlContainer(supabaseImage);
      const startedContainer = await container.start();

      try {
        const localSql = postgres(
          startedContainer.getConnectionUri(),
          postgresConfig,
        );

        try {
          // Extract fresh Supabase catalog
          const localCatalog = await extractCatalog(localSql);

          // Generate diff from fresh Supabase to remote state
          migrationScript = generateMigrationScript(
            localCatalog,
            remoteCatalog,
          );

          if (!migrationScript) {
            return {
              projectRef: project.ref,
              success: true,
              issues,
              testType: "no-migrations",
            };
          }

          // Apply migration to local database
          try {
            if (migrationScript) {
              await localSql.unsafe(migrationScript);
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            issues.push({
              type: "invalid-sql",
              description: `Generated SQL failed to execute: ${errorMessage}`,
              details: {
                projectRef: project.ref,
                postgresVersion: project.postgres_major_version,
                sqlScript: migrationScript,
                errorMessage,
              },
            });

            return {
              projectRef: project.ref,
              success: false,
              issues,
              testType: "no-migrations",
            };
          }

          // Extract catalog after migration
          const localCatalogAfter = await extractCatalog(localSql);

          catalogsSemanticalyEqual(localCatalogAfter, remoteCatalog);

          // Check for remaining differences
          // const remainingChanges = diffCatalogs(
          //   localCatalogAfter,
          //   remoteCatalog,
          // );

          // if (remainingChanges.length > 0) {
          //   issues.push({
          //     type: "remaining-diff",
          //     description: `After applying migration, ${remainingChanges.length} differences remain`,
          //     details: {
          //       projectRef: project.ref,
          //       postgresVersion: project.postgres_version,
          //       sqlScript: migrationScript,
          //       remainingChanges: remainingChanges.map((change) =>
          //         change.serialize(),
          //       ),
          //     },
          //   });
          // }

          return {
            projectRef: project.ref,
            success: true, //remainingChanges.length === 0,
            issues,
            testType: "no-migrations",
          };
        } finally {
          await localSql.end();
        }
      } finally {
        await startedContainer.stop();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      issues.push({
        type: "catalog-extraction-error",
        description: `Failed to extract catalog: ${errorMessage}`,
        details: {
          projectRef: project.ref,
          postgresVersion: project.postgres_major_version,
          errorMessage,
          sqlScript: migrationScript ?? "",
        },
      });

      return {
        projectRef: project.ref,
        success: false,
        issues,
        testType: "no-migrations",
      };
    } finally {
      await remoteSql.end();
    }
  }

  private async testProjectWithMigrations(
    project: ProjectData,
  ): Promise<TestResult> {
    const issues: Issue[] = [];

    // Start two fresh Supabase containers
    const supabaseImage = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[project.postgres_major_version as PostgresVersion]}`;
    const [sourceContainer, testContainer] = await Promise.all([
      new SupabasePostgreSqlContainer(supabaseImage).start(),
      new SupabasePostgreSqlContainer(supabaseImage).start(),
    ]);

    try {
      const sourceSql = postgres(
        sourceContainer.getConnectionUri(),
        postgresConfig,
      );
      const testSql = postgres(
        testContainer.getConnectionUri(),
        postgresConfig,
      );

      try {
        // Apply migrations step by step
        for (let i = 0; i < project.migrations.length; i++) {
          const migration = project.migrations[i];
          const migrationSql = migration.statements.join(";\n");

          // Apply migration to source database
          try {
            await sourceSql.unsafe(migrationSql);
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            issues.push({
              type: "invalid-sql",
              description: `Migration ${migration.name} failed to apply: ${errorMessage}`,
              details: {
                projectRef: project.ref,
                postgresVersion: project.postgres_major_version,
                migrationName: migration.name,
                allMigrations: project.migrations.map((m) => m.name),
                sqlScript: migrationSql,
                errorMessage,
              },
            });

            return {
              projectRef: project.ref,
              success: false,
              issues,
              testType: "with-migrations",
            };
          }

          // Extract catalogs
          const [sourceCatalog, testCatalog] = await Promise.all([
            extractCatalog(sourceSql),
            extractCatalog(testSql),
          ]);

          const migrationScript = generateMigrationScript(
            sourceCatalog,
            testCatalog,
          );

          if (!migrationScript) {
            return {
              projectRef: project.ref,
              success: true,
              issues,
              testType: "with-migrations",
            };
          }

          try {
            if (migrationScript) {
              await testSql.unsafe(migrationScript);
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            issues.push({
              type: "invalid-sql",
              description: `Generated diff for migration ${migration.name} failed to execute: ${errorMessage}`,
              details: {
                projectRef: project.ref,
                postgresVersion: project.postgres_major_version,
                migrationName: migration.name,
                allMigrations: project.migrations.map((m) => m.name),
                sqlScript: migrationScript,
                errorMessage,
              },
            });

            return {
              projectRef: project.ref,
              success: false,
              issues,
              testType: "with-migrations",
            };
          }

          // Verify no remaining differences
          const testCatalogAfter = await extractCatalog(testSql);
          const remainingChanges = diffCatalogs(
            testCatalogAfter,
            sourceCatalog,
          );

          if (remainingChanges.length > 0) {
            issues.push({
              type: "remaining-diff",
              description: `After applying diff for migration ${migration.name}, ${remainingChanges.length} differences remain`,
              details: {
                projectRef: project.ref,
                postgresVersion: project.postgres_major_version,
                migrationName: migration.name,
                allMigrations: project.migrations.map((m) => m.name),
                sqlScript: migrationScript,
                remainingChanges: remainingChanges.map((change) =>
                  change.serialize(),
                ),
              },
            });
          }
        }

        // Final check against remote database
        const remoteSql = postgres(
          project.connection_strings.postgres,
          postgresConfig,
        );

        try {
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
              testType: "with-migrations",
            };
          }

          try {
            if (finalMigrationScript) {
              await sourceSql.unsafe(finalMigrationScript);
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            issues.push({
              type: "invalid-sql",
              description: `Final diff script failed to execute: ${errorMessage}`,
              details: {
                projectRef: project.ref,
                postgresVersion: project.postgres_major_version,
                allMigrations: project.migrations.map((m) => m.name),
                sqlScript: finalMigrationScript,
                errorMessage,
              },
            });

            return {
              projectRef: project.ref,
              success: false,
              issues,
              testType: "with-migrations",
            };
          }

          // Final verification
          const finalCatalogAfter = await extractCatalog(sourceSql);
          const finalRemainingChanges = diffCatalogs(
            finalCatalogAfter,
            remoteCatalog,
          );

          if (finalRemainingChanges.length > 0) {
            issues.push({
              type: "remaining-diff",
              description: `After applying final diff, ${finalRemainingChanges.length} differences remain`,
              details: {
                projectRef: project.ref,
                postgresVersion: project.postgres_major_version,
                allMigrations: project.migrations.map((m) => m.name),
                sqlScript: finalMigrationScript,
                remainingChanges: finalRemainingChanges.map((change) =>
                  change.serialize(),
                ),
              },
            });
          }
        } finally {
          await remoteSql.end();
        }

        return {
          projectRef: project.ref,
          success: issues.length === 0,
          issues,
          testType: "with-migrations",
        };
      } finally {
        await Promise.all([sourceSql.end(), testSql.end()]);
      }
    } finally {
      await Promise.all([sourceContainer.stop(), testContainer.stop()]);
    }
  }

  private async generateIssueFiles(result: TestResult): Promise<void> {
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

// Enable locally to run the test
test("real-project-roundtrip-test", async () => {
  await main();
});

async function main() {
  try {
    let projectsData = JSON.parse(
      await readFile("database-extraction-results.json", "utf-8"),
    ) as ProjectData[];

    projectsData = projectsData.filter((p) => p.ref === "firmdujfeupgocnckibm");

    const tester = new RealProjectRoundtripTester();
    const results = await tester.runTests(projectsData, 1);

    // Print summary
    console.log(`\n${"=".repeat(50)}`);
    console.log("ROUNDTRIP TEST SUMMARY");
    console.log("=".repeat(50));

    const passed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);

    console.log(`Total Projects: ${results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total Issues: ${totalIssues}`);

    const issuesByType = results
      .flatMap((r) => r.issues)
      .reduce(
        (acc, issue) => {
          acc[issue.type] = (acc[issue.type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

    console.log("\nIssues by Type:");
    for (const [type, count] of Object.entries(issuesByType)) {
      console.log(`  ${type}: ${count}`);
    }

    console.log(`\nIssue files generated in: diff-issues/staging/`);
  } catch (error) {
    console.error("Test execution failed:", error);
  }
}

function generateMigrationScript(mainCatalog: Catalog, branchCatalog: Catalog) {
  const changes = diffCatalogs(mainCatalog, branchCatalog);

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
