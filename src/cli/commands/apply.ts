/**
 * Apply command - apply a plan's migration script to a target database.
 */

import { readFile } from "node:fs/promises";
import { buildCommand, type CommandContext } from "@stricli/core";
import chalk from "chalk";
import { applyPlan } from "../../core/plan/apply.ts";
import { deserializePlan, type Plan } from "../../core/plan/index.ts";

export const applyCommand = buildCommand({
  parameters: {
    flags: {
      plan: {
        kind: "parsed",
        brief: "Path to plan file (JSON format)",
        parse: String,
      },
      source: {
        kind: "parsed",
        brief: "Source database connection URL (current state)",
        parse: String,
      },
      target: {
        kind: "parsed",
        brief: "Target database connection URL (desired state)",
        parse: String,
      },
      unsafe: {
        kind: "boolean",
        brief: "Allow data-loss operations (unsafe mode)",
        optional: true,
      },
    },
    aliases: {
      p: "plan",
      s: "source",
      t: "target",
      u: "unsafe",
    },
  },
  docs: {
    brief: "Apply a plan's migration script to a database",
    fullDescription: `
Apply changes from a plan file to a target database.

The plan file should be a JSON file created with "pgdelta plan --output <file>.plan.json" (or any .plan/.json path).

Safe by default: will refuse plans containing data-loss unless --unsafe is set.

Exit codes:
  0 - Success (changes applied)
  1 - Error occurred
    `.trim(),
  },
  async func(
    this: CommandContext,
    flags: {
      plan: string;
      source: string;
      target: string;
      unsafe?: boolean;
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

    if (!flags.unsafe) {
      if (!plan.risk) {
        this.process.stderr.write(
          "Plan is missing risk metadata. Regenerate the plan with the current pgdelta or re-run with --unsafe to apply anyway.\n",
        );
        process.exitCode = 1;
        return;
      }
      if (plan.risk.level === "data_loss") {
        const warningLines = [
          chalk.yellow("⚠ Data-loss operations detected:"),
          ...plan.risk.dataLoss.map((entry) =>
            chalk.yellow(`- ${entry.reason}`),
          ),
          chalk.yellow(
            "Use `pgdelta apply --unsafe` to allow applying these operations.",
          ),
        ];
        this.process.stderr.write(`${warningLines.join("\n")}\n`);
        process.exitCode = 1;
        return;
      }
    }

    const result = await applyPlan(plan, flags.source, flags.target, {
      verifyPostApply: true,
    });

    switch (result.status) {
      case "invalid_plan":
        this.process.stderr.write(`${result.message}\n`);
        process.exitCode = 1;
        return;
      case "fingerprint_mismatch":
        this.process.stderr.write(
          "Target database does not match plan source fingerprint. Aborting.\n",
        );
        process.exitCode = 1;
        return;
      case "already_applied":
        this.process.stdout.write(
          "Plan already applied (target fingerprint matches desired state).\n",
        );
        return;
      case "failed": {
        this.process.stderr.write(
          `Failed to apply changes: ${result.error instanceof Error ? result.error.message : String(result.error)}\n`,
        );
        this.process.stderr.write(`Migration script:\n${result.script}\n`);
        process.exitCode = 1;
        return;
      }
      case "applied": {
        this.process.stdout.write(
          `Applying ${result.statements} changes to database...\n`,
        );
        this.process.stdout.write("Successfully applied all changes.\n");
        if (result.warnings?.length) {
          for (const warning of result.warnings) {
            this.process.stderr.write(`Warning: ${warning}\n`);
          }
        }
        return;
      }
    }
  },
});
