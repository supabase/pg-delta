/**
 * Shared utility functions for CLI commands.
 */

import { createInterface } from "node:readline";
import type { CommandContext } from "@stricli/core";
import chalk from "chalk";
import type { Change } from "../core/change.types.ts";
import type { DiffContext } from "../core/context.ts";
import { groupChangesHierarchically } from "../core/plan/hierarchy.ts";
import { type Plan, serializePlan } from "../core/plan/index.ts";
import { classifyChangesRisk } from "../core/plan/risk.ts";
import { formatSqlScript } from "../core/plan/statements.ts";
import { formatTree } from "./formatters/index.ts";

// Re-export ApplyPlanResult type for convenience
type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; script: string };

type PlanResult = {
  plan: Plan;
  sortedChanges: Change[];
  ctx: DiffContext;
};

interface FormatPlanOptions {
  disableColors?: boolean;
  showUnsafeFlagSuggestion?: boolean;
}

/**
 * Formats a plan result for display in various formats.
 */
export function formatPlanForDisplay(
  planResult: PlanResult,
  format: "tree" | "json" | "sql",
  options: FormatPlanOptions = {},
): { content: string; label: string } {
  const { plan, sortedChanges, ctx } = planResult;
  const risk = plan.risk ?? classifyChangesRisk(sortedChanges);
  const planWithRisk = plan.risk ? plan : { ...plan, risk };

  switch (format) {
    case "sql": {
      const content = [
        `-- Risk: ${risk.level === "data_loss" ? `data-loss (${risk.statements.length})` : "safe"}`,
        formatSqlScript(plan.statements),
      ].join("\n");
      return { content, label: "Migration script" };
    }
    case "json": {
      const content = serializePlan(planWithRisk);
      return { content, label: "Plan" };
    }
    default: {
      const hierarchy = groupChangesHierarchically(ctx, sortedChanges);
      const previousLevel = chalk.level;
      if (options.disableColors) {
        chalk.level = 0;
      }
      try {
        let treeContent = formatTree(hierarchy);
        if (risk.level === "data_loss") {
          const warningLines = [
            "",
            chalk.yellow("⚠ Data-loss operations detected:"),
            ...risk.statements.map((statement: string) =>
              chalk.yellow(`- ${statement}`),
            ),
          ];
          if (options.showUnsafeFlagSuggestion !== false) {
            warningLines.push(
              chalk.yellow(
                "Use `--unsafe` to allow applying these operations.",
              ),
            );
          }
          const treeLines = treeContent.split("\n");
          // Insert warning after the legend (at the end of the output)
          // Find the legend line which contains "create", "alter", and "drop"
          let insertIndex = treeLines.length;
          const ansiPattern = new RegExp(
            `${String.fromCharCode(27)}\\[[0-9;]*m`,
            "g",
          );
          // Search from the end backwards for the legend
          for (let i = treeLines.length - 1; i >= 0; i--) {
            const line = treeLines[i];
            const stripped = line.replace(ansiPattern, "").trim();
            // Legend format: "+ create   ~ alter   - drop" (or variations)
            if (
              stripped.includes("create") &&
              stripped.includes("alter") &&
              stripped.includes("drop")
            ) {
              insertIndex = i + 1;
              break;
            }
          }
          // Fallback: if legend not found, append at the end
          if (insertIndex === treeLines.length) {
            insertIndex = treeLines.length;
          }
          treeLines.splice(insertIndex, 0, ...warningLines);
          treeContent = treeLines.join("\n");
        }
        // add newline for nicer stdout when in tree mode
        if (!treeContent.endsWith("\n")) {
          treeContent = `${treeContent}\n`;
        }
        return { content: treeContent, label: "Human-readable plan" };
      } finally {
        if (options.disableColors) {
          chalk.level = previousLevel;
        }
      }
    }
  }
}

/**
 * Validates plan risk and handles unsafe operations.
 * Returns validation result with optional exit code.
 */
export function validatePlanRisk(
  plan: Plan,
  unsafe: boolean,
  context: CommandContext,
  options?: { suppressWarning?: boolean },
): { valid: boolean; exitCode?: number } {
  if (!unsafe) {
    if (!plan.risk) {
      context.process.stderr.write(
        "Plan is missing risk metadata. Regenerate the plan with the current pgdelta or re-run with --unsafe to apply anyway.\n",
      );
      return { valid: false, exitCode: 1 };
    }
    if (plan.risk.level === "data_loss") {
      if (!options?.suppressWarning) {
        const warningLines = [
          chalk.yellow("⚠ Data-loss operations detected:"),
          ...plan.risk.statements.map((statement: string) =>
            chalk.yellow(`- ${statement}`),
          ),
          chalk.yellow("Use `--unsafe` to allow applying these operations."),
        ];
        context.process.stderr.write(`${warningLines.join("\n")}\n`);
      }
      return { valid: false, exitCode: 1 };
    }
  }
  return { valid: true };
}

/**
 * Handles applyPlan results and writes appropriate output.
 * Returns the exit code that should be set.
 */
export function handleApplyResult(
  result: ApplyPlanResult,
  context: CommandContext,
): { exitCode: number } {
  switch (result.status) {
    case "invalid_plan":
      context.process.stderr.write(`${result.message}\n`);
      return { exitCode: 1 };
    case "fingerprint_mismatch":
      context.process.stderr.write(
        "Target database does not match plan source fingerprint. Aborting.\n",
      );
      return { exitCode: 1 };
    case "already_applied":
      context.process.stdout.write(
        "Plan already applied (target fingerprint matches desired state).\n",
      );
      return { exitCode: 0 };
    case "failed": {
      context.process.stderr.write(
        `Failed to apply changes: ${result.error instanceof Error ? result.error.message : String(result.error)}\n`,
      );
      context.process.stderr.write(`Migration script:\n${result.script}\n`);
      return { exitCode: 1 };
    }
    case "applied": {
      context.process.stdout.write(
        `Applying ${result.statements} changes to database...\n`,
      );
      context.process.stdout.write("Successfully applied all changes.\n");
      if (result.warnings?.length) {
        for (const warning of result.warnings) {
          context.process.stderr.write(`Warning: ${warning}\n`);
        }
      }
      return { exitCode: 0 };
    }
  }
}

/**
 * Prompts user for confirmation using readline.
 * Returns true for 'y'/'yes', false otherwise.
 */
export function promptConfirmation(
  question: string,
  context: CommandContext,
): Promise<boolean> {
  return new Promise((resolve) => {
    // Access stdin/stdout from the process object
    // Type assertion needed because CommandContext.process may not expose stdin in its type
    const process = context.process as unknown as {
      stdin: NodeJS.ReadableStream;
      stdout: NodeJS.WritableStream;
    };
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}
