/**
 * Sync command - plan and apply changes in one go with confirmation prompt.
 */

import { buildCommand, type CommandContext } from "@stricli/core";

export const syncCommand = buildCommand({
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
    },
    aliases: {
      f: "from",
      t: "to",
      y: "yes",
      u: "unsafe",
    },
  },
  docs: {
    brief: "Plan and apply schema changes in one go",
    fullDescription: `
Compute the schema diff between two PostgreSQL databases (from → to),
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
    _flags: {
      from: string;
      to: string;
      yes?: boolean;
    },
  ) {
    // TODO: Implement sync logic
    // 1. Run plan logic
    // 2. Display plan
    // 3. Prompt for confirmation (unless --yes)
    // 4. Apply changes if confirmed

    this.process.stdout.write("synced\n");
  },
});
