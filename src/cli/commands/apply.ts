/**
 * Apply command - apply a plan's migration script to a target database.
 */

import { readFile } from "node:fs/promises";
import { buildCommand, type CommandContext } from "@stricli/core";
import { applyPlan } from "../../core/plan/apply.ts";
import { deserializePlan, type Plan } from "../../core/plan/index.ts";
import { handleApplyResult, validatePlanRisk } from "../utils.ts";

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

    const validation = validatePlanRisk(plan, !!flags.unsafe, this);
    if (!validation.valid) {
      process.exitCode = validation.exitCode ?? 1;
      return;
    }

    const result = await applyPlan(plan, flags.source, flags.target, {
      verifyPostApply: true,
    });

    const { exitCode } = handleApplyResult(result, this);
    process.exitCode = exitCode;
  },
});
