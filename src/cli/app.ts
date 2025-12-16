import { buildApplication, buildRouteMap } from "@stricli/core";
import { applyCommand } from "./commands/apply.ts";
import { planCommand } from "./commands/plan.ts";
import { syncCommand } from "./commands/sync.ts";

const root = buildRouteMap({
  routes: {
    plan: planCommand,
    apply: applyCommand,
    sync: syncCommand,
  },
  defaultCommand: "sync",
  docs: {
    brief: "PostgreSQL migrations made easy",
    fullDescription: `
pgdelta generates migration scripts by comparing two PostgreSQL databases.

Commands:
  plan   - Compute schema diff and preview changes
  apply  - Apply a plan's migration script to a database
  sync   - Plan and apply changes in one go
    `.trim(),
  },
});

export const app = buildApplication(root, {
  name: "pgdelta",
});
