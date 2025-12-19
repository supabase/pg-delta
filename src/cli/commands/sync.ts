/**
 * Sync command - plan and apply changes in one go with confirmation prompt.
 */

import { buildCommand, type CommandContext } from "@stricli/core";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";
import type { ChangeFilter, ChangeSerializer } from "../../core/main.ts";
import { applyPlan } from "../../core/plan/apply.ts";
import { createPlan } from "../../core/plan/index.ts";
import { loadIntegrationDSL } from "../utils/integrations.ts";
import {
  formatPlanForDisplay,
  handleApplyResult,
  promptConfirmation,
  validatePlanRisk,
} from "../utils.ts";

export const syncCommand = buildCommand({
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
      yes: {
        kind: "boolean",
        brief: "Skip confirmation prompt and apply changes automatically",
        optional: true,
      },
      unsafe: {
        kind: "boolean",
        brief: "Allow data-loss operations (unsafe mode)",
        optional: true,
      },
      role: {
        kind: "parsed",
        brief:
          "Role to use when executing the migration (SET ROLE will be added to statements).",
        parse: String,
        optional: true,
      },
      filter: {
        kind: "parsed",
        brief:
          'Filter DSL as inline JSON to filter changes (e.g., \'{"schema":"public"}\').',
        parse: (value: string): FilterDSL => {
          try {
            return JSON.parse(value) as FilterDSL;
          } catch (error) {
            throw new Error(
              `Invalid filter JSON: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
        optional: true,
      },
      serialize: {
        kind: "parsed",
        brief:
          'Serialize DSL as inline JSON array (e.g., \'[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]\').',
        parse: (value: string): SerializeDSL => {
          try {
            return JSON.parse(value) as SerializeDSL;
          } catch (error) {
            throw new Error(
              `Invalid serialize JSON: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
        optional: true,
      },
      integration: {
        kind: "parsed",
        brief:
          "Integration name (e.g., 'supabase') or path to integration JSON file (must end with .json). Loads from core/integrations/ or file path.",
        parse: String,
        optional: true,
      },
    },
    aliases: {
      s: "source",
      t: "target",
      y: "yes",
      u: "unsafe",
    },
  },
  docs: {
    brief: "Plan and apply schema changes in one go",
    fullDescription: `
Compute the schema diff between two PostgreSQL databases (source → target),
display the plan, prompt for confirmation, and apply changes if confirmed.

Use --yes to skip the confirmation prompt and apply changes automatically.
Safe by default: refuses data-loss changes unless --unsafe is set.

Exit codes:
  0 - Success (changes applied or no changes detected)
  1 - Error occurred
  2 - User cancelled or changes detected but not applied
    `.trim(),
  },
  async func(
    this: CommandContext,
    flags: {
      source: string;
      target: string;
      yes?: boolean;
      unsafe?: boolean;
      role?: string;
      filter?: FilterDSL;
      serialize?: SerializeDSL;
      integration?: string;
    },
  ) {
    // Load integration if provided and extract filter/serialize DSL
    let filterOption: FilterDSL | ChangeFilter | undefined = flags.filter;
    let serializeOption: SerializeDSL | ChangeSerializer | undefined =
      flags.serialize;
    if (flags.integration) {
      const integrationDSL = await loadIntegrationDSL(flags.integration);
      // Use integration DSL if explicit flags not provided
      filterOption = filterOption ?? integrationDSL.filter;
      serializeOption = serializeOption ?? integrationDSL.serialize;
    }

    // 1. Create the plan
    const planResult = await createPlan(flags.source, flags.target, {
      role: flags.role,
      filter: filterOption,
      serialize: serializeOption,
    });
    if (!planResult) {
      this.process.stdout.write("No changes detected.\n");
      process.exitCode = 0;
      return;
    }

    // 2. Display the plan
    const { content } = formatPlanForDisplay(planResult, "tree");
    this.process.stdout.write(content);

    // 3. Validate risk (suppress warning since it's already shown in the plan)
    const validation = validatePlanRisk(planResult.plan, !!flags.unsafe, this, {
      suppressWarning: true,
    });
    if (!validation.valid) {
      process.exitCode = validation.exitCode ?? 1;
      return;
    }

    // 4. Prompt for confirmation (unless --yes)
    if (!flags.yes) {
      const confirmed = await promptConfirmation(
        "Apply these changes? (y/N) ",
        this,
      );
      if (!confirmed) {
        process.exitCode = 2;
        return;
      }
    }

    // 5. Apply the plan
    const result = await applyPlan(
      planResult.plan,
      flags.source,
      flags.target,
      {
        verifyPostApply: true,
      },
    );

    // 6. Handle apply result
    const { exitCode } = handleApplyResult(result, this);
    process.exitCode = exitCode;
  },
});
