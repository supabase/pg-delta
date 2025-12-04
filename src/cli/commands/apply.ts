/**
 * Apply command - apply a plan's migration script to a target database.
 */

import { readFile } from "node:fs/promises";
import { buildCommand, type CommandContext } from "@stricli/core";
import postgres from "postgres";
import { deserializePlan, type Plan } from "../../core/plan/index.ts";
import { postgresConfig } from "../../core/postgres-config.ts";

export const applyCommand = buildCommand({
  parameters: {
    flags: {
      plan: {
        kind: "parsed",
        brief: "Path to plan file (JSON format)",
        parse: String,
      },
      database: {
        kind: "parsed",
        brief: "Target database connection URL",
        parse: String,
      },
      dryRun: {
        kind: "boolean",
        brief: "Show what would be executed without executing",
        optional: true,
      },
    },
    aliases: {
      p: "plan",
      d: "database",
    },
  },
  docs: {
    brief: "Apply a plan's migration script to a database",
    fullDescription: `
Apply changes from a plan file to a target database.

The plan file should be a JSON file created with "pgdelta plan --format json --output <file>".

Exit codes:
  0 - Success (changes applied)
  1 - Error occurred
    `.trim(),
  },
  async func(
    this: CommandContext,
    flags: {
      plan: string;
      database: string;
      dryRun?: boolean;
    },
  ) {
    // Read and parse plan file
    let planJson: string;
    try {
      planJson = await readFile(flags.plan, "utf-8");
    } catch (error) {
      this.process.stderr.write(
        `Error reading plan file: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
      return;
    }

    let plan: Plan;
    try {
      plan = deserializePlan(planJson);
    } catch (error) {
      this.process.stderr.write(
        `Error parsing plan file: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
      return;
    }

    // Validate plan has SQL
    if (!plan.sql || plan.sql.trim().length === 0) {
      this.process.stdout.write("Plan contains no SQL to execute.\n");
      return;
    }

    // Dry run: just show what would be executed
    if (flags.dryRun) {
      this.process.stdout.write("Dry run - would execute:\n\n");
      this.process.stdout.write(plan.sql);
      this.process.stdout.write("\n");
      return;
    }

    // Connect to target database
    const sql = postgres(flags.database, postgresConfig);

    try {
      // Execute the SQL script
      // Split by ";\n\n" which is how plan command joins statements
      // This is safer than splitting by ";" alone as it avoids breaking on semicolons in strings
      const statements = plan.sql
        .split(";\n\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s !== ";");

      this.process.stdout.write(
        `Applying ${plan.stats.total} changes to database...\n`,
      );

      // Execute all statements in a transaction for atomicity
      await sql.begin(async (sql) => {
        for (const statement of statements) {
          // Remove trailing semicolon if present (from the last statement)
          const cleanStatement = statement.replace(/;\s*$/, "");
          if (cleanStatement.length === 0) continue;

          try {
            await sql.unsafe(cleanStatement);
          } catch (error) {
            this.process.stderr.write(
              `Error executing statement: ${error instanceof Error ? error.message : String(error)}\n`,
            );
            this.process.stderr.write(`Failed statement: ${cleanStatement}\n`);
            throw error; // This will rollback the transaction
          }
        }
      });

      this.process.stdout.write("Successfully applied all changes.\n");
    } catch (error) {
      this.process.stderr.write(
        `Failed to apply changes: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    } finally {
      await sql.end();
    }
  },
});
