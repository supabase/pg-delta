import { buildApplication, buildRouteMap } from "@stricli/core";
import { diffCommand } from "./commands/diff.ts";
import { planCommand } from "./commands/plan.ts";

const root = buildRouteMap({
  routes: {
    diff: diffCommand,
    plan: planCommand,
  },
  defaultCommand: "plan",
  docs: {
    brief: "PostgreSQL migrations made easy",
    fullDescription: `
pgdelta generates migration scripts by comparing two PostgreSQL databases.

Commands:
  plan   - Compute schema diff and preview changes
  diff   - Generate migration script (legacy)
    `.trim(),
  },
});

export const app = buildApplication(root, {
  name: "pgdelta",
});
