/**
 * Plan command - compute schema diff and preview changes.
 */

import { writeFile } from "node:fs/promises";
import { buildCommand, type CommandContext } from "@stricli/core";
import chalk from "chalk";
import { groupChangesHierarchically } from "../../core/plan/hierarchy.ts";
import { createPlan, serializePlan } from "../../core/plan/index.ts";
import { classifyChangesRisk } from "../../core/plan/risk.ts";
import { formatSqlScript } from "../../core/plan/statements.ts";
import { formatTree } from "../formatters/index.ts";

export const planCommand = buildCommand({
  parameters: {
    flags: {
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
      format: {
        kind: "enum",
        brief: "Output format override: json (plan) or sql (script).",
        values: ["json", "sql"] as const,
        optional: true,
      },
      output: {
        kind: "parsed",
        brief:
          "Write output to file (stdout by default). If format is not set: .sql infers sql, .json infers json, otherwise uses human output.",
        parse: String,
        optional: true,
      },
    },
    aliases: {
      s: "source",
      t: "target",
      o: "output",
    },
  },
  docs: {
    brief: "Compute schema diff and preview changes",
    fullDescription: `
Compute the schema diff between two PostgreSQL databases (source → target),
and preview it for review or scripting. Defaults to tree display;
json/sql outputs are available for artifacts or piping.
    `.trim(),
  },
  async func(
    this: CommandContext,
    flags: {
      source: string;
      target: string;
      format?: "json" | "sql";
      output?: string;
    },
  ) {
    const planResult = await createPlan(flags.source, flags.target);
    if (!planResult) {
      this.process.stdout.write("No changes detected.\n");
      return;
    }

    const { plan, sortedChanges, ctx } = planResult;
    const risk = plan.risk ?? classifyChangesRisk(sortedChanges);
    const planWithRisk = plan.risk ? plan : { ...plan, risk };

    const outputPath = flags.output;
    let effectiveFormat: "tree" | "json" | "sql";
    if (flags.format) {
      effectiveFormat = flags.format;
    } else if (outputPath?.endsWith(".sql")) {
      effectiveFormat = "sql";
    } else if (outputPath?.endsWith(".json")) {
      effectiveFormat = "json";
    } else {
      effectiveFormat = "tree";
    }

    let content: string;
    let writtenLabel: string;
    switch (effectiveFormat) {
      case "sql":
        content = [
          `-- Risk: ${risk.level === "data_loss" ? `data-loss (${risk.dataLoss.length})` : "safe"}`,
          formatSqlScript(plan.statements),
        ].join("\n");
        writtenLabel = "Migration script";
        break;
      case "json":
        content = serializePlan(planWithRisk);
        writtenLabel = "Plan";
        break;
      default: {
        const hierarchy = groupChangesHierarchically(ctx, sortedChanges);
        const previousLevel = chalk.level;
        if (outputPath) {
          chalk.level = 0; // disable colors when writing to file
        }
        try {
          let treeContent = formatTree(hierarchy);
          if (risk.level === "data_loss") {
            const warningLines = [
              "",
              chalk.yellow("⚠ Data-loss operations detected:"),
              ...risk.dataLoss.map((entry) =>
                chalk.yellow(`- ${entry.reason}`),
              ),
              chalk.yellow(
                "Use `pgdelta apply --unsafe` to allow applying these operations.",
              ),
            ];
            const treeLines = treeContent.split("\n");
            treeLines.splice(1, 0, ...warningLines);
            treeContent = treeLines.join("\n");
          }
          content = treeContent;
        } finally {
          if (outputPath) {
            chalk.level = previousLevel;
          }
        }
        // add newline for nicer stdout when in tree mode
        if (!outputPath && !content.endsWith("\n")) {
          content = `${content}\n`;
        }
        writtenLabel = "Human-readable plan";
        break;
      }
    }

    if (outputPath) {
      await writeFile(outputPath, content, "utf-8");
      this.process.stdout.write(`${writtenLabel} written to ${outputPath}\n`);
    } else {
      this.process.stdout.write(content);
      if (!content.endsWith("\n")) {
        this.process.stdout.write("\n");
      }
    }

    // Exit code 2 indicates changes were detected
    process.exitCode = 2;
  },
});
