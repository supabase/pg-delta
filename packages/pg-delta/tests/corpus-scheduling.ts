import type { Scenario } from "./corpus.ts";

// Roles, role memberships, and other cluster-level objects are GLOBAL on the
// shared cluster. A scenario that touches them in either state or either
// direction's seed must not share the opt-in concurrent corpus pool.
const ROLE_DDL = /\b(?:create|drop|alter)\s+(?:role|user|group)\b/i;

export function mustRunSerially(scenario: Scenario): boolean {
  return (
    scenario.meta.isolatedCluster === true ||
    ROLE_DDL.test(scenario.a) ||
    ROLE_DDL.test(scenario.b) ||
    (scenario.seed !== undefined && ROLE_DDL.test(scenario.seed)) ||
    (scenario.seedB !== undefined && ROLE_DDL.test(scenario.seedB))
  );
}
