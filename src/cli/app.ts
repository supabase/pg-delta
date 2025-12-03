import { buildApplication, buildRouteMap } from "@stricli/core";
import { diffCommand } from "./commands/diff.ts";

const root = buildRouteMap({
  routes: {
    diff: diffCommand,
  },
  defaultCommand: "diff",
  docs: {
    brief: "PostgreSQL migrations made easy",
    fullDescription:
      "pgdelta generates migration scripts by comparing two PostgreSQL databases.",
  },
});

export const app = buildApplication(root, {
  name: "pgdelta",
});
