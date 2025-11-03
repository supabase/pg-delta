import { exec as baseExec } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import dedent from "dedent";
import postgres from "postgres";
import { test as baseTest, describe } from "vitest";
import { supabase } from "../../src/integrations/supabase.ts";
import { main } from "../../src/main.ts";

const exec = promisify(baseExec);

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Function to save error details to markdown file
async function saveErrorReport(
  projectId: string,
  migrationScript: string,
  error: unknown,
  postgresVersion: number | null,
  generationTimeMs: number,
): Promise<void> {
  const errorDir = join(__dirname, "diff-reports");
  await mkdir(errorDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `error-${projectId}-${timestamp}.md`;
  const filepath = join(errorDir, filename);

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  const generationTimeSeconds = (generationTimeMs / 1000).toFixed(2);

  const markdownContent = dedent`
    # Migration Error Report
    
    **Project ID:** ${projectId}
    **PostgreSQL Version:** ${postgresVersion || "Unknown"}
    **Timestamp:** ${new Date().toISOString()}
    
    ## Timing
    
    - **Migration Generation Time:** ${generationTimeSeconds}s
    
    ## Error Details
    
    \`\`\`
    ${errorMessage}
    \`\`\`
    
    ${errorStack ? `## Stack Trace\n\n\`\`\`\n${errorStack}\n\`\`\`` : ""}
    
    ## Migration Script
    
    \`\`\`sql
    ${migrationScript}
    \`\`\`
  `;

  await writeFile(filepath, markdownContent);
  console.log(`Error report saved to: ${filepath}`);
}

// Function to save success details to markdown file
async function saveSuccessReport(
  projectId: string,
  migrationScript: string,
  postgresVersion: number | null,
  generationTimeMs: number,
): Promise<void> {
  const successDir = join(__dirname, "diff-reports");
  await mkdir(successDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `success-${projectId}-${timestamp}.md`;
  const filepath = join(successDir, filename);

  const generationTimeSeconds = (generationTimeMs / 1000).toFixed(2);

  const markdownContent = dedent`
    # Migration Success Report
    
    **Project ID:** ${projectId}
    **PostgreSQL Version:** ${postgresVersion || "Unknown"}
    **Timestamp:** ${new Date().toISOString()}
    
    ## Timing
    
    - **Migration Generation Time:** ${generationTimeSeconds}s
    
    ## Migration Script
    
    \`\`\`sql
    ${migrationScript}
    \`\`\`
  `;

  await writeFile(filepath, markdownContent);
  console.log(`Success report saved to: ${filepath}`);
}

const testedProjectsFilePath = join(__dirname, "tested-projects.json");

type StoredTestResult = {
  projectId: string;
  status: "success" | "error";
  timestamp: string;
  reason?: string;
  generationTimeMs?: number;
};

let cachedStoredTestResults: StoredTestResult[] | null = null;

function normalizeStoredTestResult(entry: unknown): StoredTestResult | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const projectId =
    typeof record.projectId === "string"
      ? record.projectId
      : typeof record.projectRef === "string"
        ? record.projectRef
        : undefined;

  const status =
    record.status === "success" || record.status === "error"
      ? record.status
      : undefined;

  if (!projectId || !status) {
    return null;
  }

  const normalized: StoredTestResult = {
    projectId,
    status,
    timestamp:
      typeof record.timestamp === "string"
        ? record.timestamp
        : new Date().toISOString(),
  };

  if (typeof record.reason === "string") {
    normalized.reason = record.reason;
  }

  if (typeof record.generationTimeMs === "number") {
    normalized.generationTimeMs = record.generationTimeMs;
  }

  return normalized;
}

async function loadStoredTestResults(): Promise<StoredTestResult[]> {
  if (cachedStoredTestResults !== null) {
    return cachedStoredTestResults;
  }

  try {
    const content = await readFile(testedProjectsFilePath, "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      cachedStoredTestResults = [];
      return cachedStoredTestResults;
    }

    const deduped = new Map<string, StoredTestResult>();
    for (const entry of parsed) {
      const normalized = normalizeStoredTestResult(entry);
      if (!normalized) {
        continue;
      }
      deduped.set(normalized.projectId, normalized);
    }

    cachedStoredTestResults = Array.from(deduped.values());
  } catch {
    cachedStoredTestResults = [];
  }

  return cachedStoredTestResults;
}

async function recordStoredTestResult(result: StoredTestResult): Promise<void> {
  const existingResults = new Map(
    (await loadStoredTestResults()).map((entry) => [entry.projectId, entry]),
  );
  existingResults.set(result.projectId, result);

  const nextResults = Array.from(existingResults.values());
  cachedStoredTestResults = nextResults;
  await writeFile(testedProjectsFilePath, JSON.stringify(nextResults, null, 2));
}

interface Project {
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
  postgres_major_version: 15 | 17 | null;
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

function getTest(remoteProject: Project) {
  return baseTest.extend<{
    db: { local: string; remote: string };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const tempDir = await mkdtemp(join(tmpdir(), `supabase-`));
      const supabaseDirPath = join(tempDir, "supabase");
      try {
        await mkdir(supabaseDirPath);
        await writeFile(
          join(supabaseDirPath, "config.toml"),
          dedent`
          [db]
          major_version = ${remoteProject.postgres_major_version}`,
        );
        await exec(`npx --yes supabase@latest start`, { cwd: supabaseDirPath });
        const { stdout } = await exec(
          `npx supabase@latest status --output json`,
          {
            cwd: supabaseDirPath,
          },
        );
        const { DB_URL } = JSON.parse(stdout) as { DB_URL: string };

        await use({
          local: DB_URL,
          remote: remoteProject.connection_strings.postgres,
        });
      } finally {
        await exec(`npx supabase@latest stop --no-backup`, {
          cwd: supabaseDirPath,
        });
        await rm(tempDir, { recursive: true });
      }
    },
  });
}

describe.sequential(
  "supabase",
  async () => {
    const remoteProjectsFile = await readFile(
      join(__dirname, "database-extraction-results.json"),
      "utf-8",
    );
    const remoteProjects = JSON.parse(remoteProjectsFile) as Project[];

    const storedResults = await loadStoredTestResults();
    const testedProjectIds = new Set(
      storedResults.map((result) => result.projectId),
    );

    let failedProjects = remoteProjects.filter((project) =>
      [
        // permission denied for schema public
        "jjqwaskwktqjmyyuqrix",
        "kagxangrfmodrgczauhj",
        "njcpgmaawmgiqzbscalt",

        // must be able to SET ROLE "developer"
        "qjtyenjjklbtvtmcjzua",

        // must be member of role "developer"
        "tqymbknzakiqyyoahpid",

        // pgroonga: [option][tokenizer][validate] invalid tokenizer: <TokenMecab>: [info][set][default-tokenizer][(anonymous)] unknown tokenizer: <TokenMecab>
        "vixakfzznwuowldennig",

        // permission denied to create role
        "xkbwyxkettxlxrpkkyhd",
      ].includes(project.ref),
    );

    // failedProjects = failedProjects.filter(
    //   (project) => !testedProjectIds.has(project.ref),
    // );

    failedProjects = failedProjects
      .sort((a, b) => a.ref.localeCompare(b.ref))
      .slice(0, 1);

    if (failedProjects.length === 0) {
      baseTest("no untested projects remaining", () => {});
      return;
    }

    for (const remoteProject of failedProjects) {
      // let sql: postgres.Sql | null = null;
      // // Attempt to connect to remote project first, if it fails, skip the test
      // try {
      //   sql = postgres(remoteProject.connection_strings.postgres, {
      //     connect_timeout: 3,
      //   });
      //   await sql`SELECT 1`;
      // } catch (error) {
      //   console.error(
      //     `Failed to connect to remote project ${remoteProject.ref}: ${error}`,
      //   );
      //   failedProjects.push(remoteProject.ref);
      //   continue;
      // } finally {
      //   await sql?.end();
      // }

      // if (!remoteProject.postgres_major_version) {
      //   console.error(
      //     `Remote project ${remoteProject.ref} has no postgres major version`,
      //   );
      //   continue;
      // }

      const test = getTest(remoteProject);

      test(`project ${remoteProject.ref}`, async ({ db }) => {
        const generationStartTime = performance.now();
        let generationTimeMs = 0;
        let migrationScript: string | null = null;
        let sql: postgres.Sql | null = null;
        let storedResult: StoredTestResult | null = null;

        try {
          migrationScript = await main(db.local, db.remote, supabase);
          generationTimeMs = Math.round(
            performance.now() - generationStartTime,
          );

          if (!migrationScript) {
            console.log(
              `No migrations needed for project ${remoteProject.ref}`,
            );
            storedResult = {
              projectId: remoteProject.ref,
              status: "success",
              timestamp: new Date().toISOString(),
              reason: "no migration needed",
              generationTimeMs,
            };
            return;
          }

          sql = postgres(db.local);
          await sql.unsafe(migrationScript);

          await saveSuccessReport(
            remoteProject.ref,
            migrationScript,
            remoteProject.postgres_major_version,
            generationTimeMs,
          );

          storedResult = {
            projectId: remoteProject.ref,
            status: "success",
            timestamp: new Date().toISOString(),
            generationTimeMs,
          };
        } catch (error) {
          if (generationTimeMs === 0) {
            generationTimeMs = Math.round(
              performance.now() - generationStartTime,
            );
          }

          const errorMessage =
            error instanceof Error ? error.message : String(error);

          storedResult = {
            projectId: remoteProject.ref,
            status: "error",
            timestamp: new Date().toISOString(),
            reason: errorMessage,
            generationTimeMs,
          };

          try {
            await saveErrorReport(
              remoteProject.ref,
              migrationScript ?? "",
              error,
              remoteProject.postgres_major_version,
              generationTimeMs,
            );
          } catch (reportError) {
            console.error(
              `Failed to write error report for project ${remoteProject.ref}: ${reportError}`,
            );
          }

          throw error;
        } finally {
          try {
            // if (storedResult) {
            //   await recordStoredTestResult(storedResult);
            // }
          } finally {
            if (sql) {
              try {
                await sql.end();
              } catch (endError) {
                console.error(
                  `Failed to close local database connection for project ${remoteProject.ref}: ${endError}`,
                );
              }
            }
          }
        }
      });
    }
  },
  3 * 60_000,
);
