/**
 * Plan command - compute schema diff and preview changes.
 */

import { writeFile } from "node:fs/promises";
import { buildCommand, type CommandContext } from "@stricli/core";
import { createPlan } from "../../core/plan/index.ts";
import { formatPlanForDisplay } from "../utils.ts";

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

    const { content, label } = formatPlanForDisplay(
      planResult,
      effectiveFormat,
      {
        disableColors: !!outputPath,
      },
    );

    if (outputPath) {
      await writeFile(outputPath, content, "utf-8");
      this.process.stdout.write(`${label} written to ${outputPath}\n`);
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
