import type { Change } from "../change.types.ts";
import { customConstraints } from "./custom-constraints.ts";
import type { Constraint } from "./types.ts";

/**
 * Generate Constraints from custom constraint functions.
 *
 * Iterates through all pairs of changes and applies each custom constraint,
 * converting the pairwise decisions into Constraints.
 */
export function generateCustomConstraints(changes: Change[]): Constraint[] {
  const constraints: Constraint[] = [];

  for (let i = 0; i < changes.length; i++) {
    for (let j = 0; j < changes.length; j++) {
      if (i === j) continue;

      const a = changes[i];
      const b = changes[j];

      for (const customConstraint of customConstraints) {
        const decision = customConstraint(a, b);
        if (!decision) continue;

        const sourceIndex = decision === "a_before_b" ? i : j;
        const targetIndex = decision === "a_before_b" ? j : i;

        constraints.push({
          sourceChangeIndex: sourceIndex,
          targetChangeIndex: targetIndex,
          source: "constraint_spec",
        });
      }
    }
  }

  return constraints;
}
