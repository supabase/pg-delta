/**
 * Plan command - compute schema diff and preview changes.
 */

import { writeFile } from "node:fs/promises";
import { buildCommand, type CommandContext } from "@stricli/core";
import postgres from "postgres";
import { diffCatalogs } from "../../core/catalog.diff.ts";
import { extractCatalog } from "../../core/catalog.model.ts";
import type { DiffContext } from "../../core/context.ts";
import { base } from "../../core/integrations/base.ts";
import type { Plan, PlanStats } from "../../core/plan/index.ts";
import {
  buildPlanScopeFingerprint,
  groupChangesHierarchically,
  hashStableIds,
  serializePlan,
  sha256,
} from "../../core/plan/index.ts";
import { postgresConfig } from "../../core/postgres-config.ts";
import { sortChanges } from "../../core/sort/sort-changes.ts";
import { formatJson, formatTree } from "../formatters/index.ts";

export const planCommand = buildCommand({
  parameters: {
    flags: {
      from: {
        kind: "parsed",
        brief: "Source database connection URL (current state)",
        parse: String,
      },
      to: {
        kind: "parsed",
        brief: "Target database connection URL (desired state)",
        parse: String,
      },
      format: {
        kind: "enum",
        brief: "Output format for human display",
        values: ["tree", "json"] as const,
        default: "tree",
        optional: true,
      },
      output: {
        kind: "parsed",
        brief:
          "Write display output to file (extension determines format: .sql = SQL only, otherwise uses --format)",
        parse: String,
        optional: true,
      },
      outPlan: {
        kind: "parsed",
        brief:
          "Write plan artifact to file (JSON format, usable with 'apply' command). Defaults to .plan.json extension if no extension provided.",
        parse: String,
        optional: true,
      },
    },
    aliases: {
      f: "from",
      t: "to",
      o: "output",
    },
  },
  docs: {
    brief: "Compute schema diff and preview changes",
    fullDescription: `
Compute the schema diff between two PostgreSQL databases (from → to),
and preview it for humans. Optionally write a reusable plan artifact
and/or a migration SQL file.

Exit codes:
  0 - No changes detected
  2 - Changes detected
  1 - Error occurred
    `.trim(),
  },
  async func(
    this: CommandContext,
    flags: {
      from: string;
      to: string;
      format?: "tree" | "json";
      output?: string;
      outPlan?: string;
    },
  ) {
    const fromSql = postgres(flags.from, postgresConfig);
    const toSql = postgres(flags.to, postgresConfig);

    try {
      // Extract catalogs
      const [fromCatalog, toCatalog] = await Promise.all([
        extractCatalog(fromSql),
        extractCatalog(toSql),
      ]);

      // Compute diff
      const changes = diffCatalogs(fromCatalog, toCatalog);

      const integration = base;
      const ctx: DiffContext = {
        mainCatalog: fromCatalog,
        branchCatalog: toCatalog,
      };

      // Apply filter
      const integrationFilter = integration.filter;
      const filteredChanges = integrationFilter
        ? changes.filter((change) => integrationFilter(ctx, change))
        : changes;

      if (filteredChanges.length === 0) {
        this.process.stdout.write("No changes detected.\n");
        return;
      }

      // Sort changes
      const sortedChanges = sortChanges(ctx, filteredChanges);

      // Generate SQL script
      const hasRoutineChanges = sortedChanges.some(
        (change) =>
          change.objectType === "procedure" ||
          change.objectType === "aggregate",
      );
      const sqlParts: string[] = [];
      if (hasRoutineChanges) {
        sqlParts.push("SET check_function_bodies = false");
      }
      for (const change of sortedChanges) {
        const sql = integration.serialize?.(ctx, change) ?? change.serialize();
        sqlParts.push(sql);
      }
      const sql = `${sqlParts.join(";\n\n")};`;

      // Compute stats
      const stats: PlanStats = {
        total: sortedChanges.length,
        creates: 0,
        alters: 0,
        drops: 0,
        byObjectType: {},
      };
      for (const change of sortedChanges) {
        switch (change.operation) {
          case "create":
            stats.creates++;
            break;
          case "alter":
            stats.alters++;
            break;
          case "drop":
            stats.drops++;
            break;
        }
        stats.byObjectType[change.objectType] =
          (stats.byObjectType[change.objectType] ?? 0) + 1;
      }

      const { hash: fingerprintFrom, stableIds } = buildPlanScopeFingerprint(
        fromCatalog,
        sortedChanges,
      );
      const fingerprintTo = hashStableIds(toCatalog, stableIds);
      const sqlHash = sha256(sql);

      const plan: Plan = {
        version: 1,
        integration: { id: "base" },
        source: { url: flags.from },
        target: { url: flags.to },
        stableIds,
        fingerprintFrom,
        fingerprintTo,
        sqlHash,
        sql,
        stats,
      };

      // Write plan artifact if requested (for use with 'apply' command)
      if (flags.outPlan) {
        const planPath =
          flags.outPlan.endsWith(".json") || flags.outPlan.endsWith(".plan")
            ? flags.outPlan
            : `${flags.outPlan}.plan.json`;
        const planJson = serializePlan(plan);
        await writeFile(planPath, planJson, "utf-8");
        this.process.stdout.write(`Plan artifact written to ${planPath}\n`);
      }

      // Determine output format based on file extension if output is specified
      const outputPath = flags.output;
      const isSqlOutput = outputPath?.endsWith(".sql") ?? false;

      // If outputting SQL, just write the SQL script
      if (outputPath && isSqlOutput) {
        await writeFile(outputPath, plan.sql, "utf-8");
        this.process.stdout.write(`Migration SQL written to ${outputPath}\n`);
        process.exitCode = 2;
        return;
      }

      // Build hierarchical structure for display (needs original Change[] objects)
      const hierarchy = groupChangesHierarchically(ctx, sortedChanges);

      // Format output for display
      const formatted =
        flags.format === "json"
          ? formatJson(plan, hierarchy)
          : formatTree(hierarchy, plan.stats);

      if (outputPath) {
        await writeFile(outputPath, formatted, "utf-8");
        this.process.stdout.write(`Plan display written to ${outputPath}\n`);
      } else {
        this.process.stdout.write(formatted);
        if (flags.format !== "json") {
          this.process.stdout.write("\n");
        }
      }

      // Exit code 2 indicates changes were detected
      process.exitCode = 2;
    } finally {
      await Promise.all([fromSql.end(), toSql.end()]);
    }
  },
});
