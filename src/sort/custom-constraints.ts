import type { Change } from "../change.types.ts";
import {
  GrantRoleDefaultPrivileges,
  RevokeRoleDefaultPrivileges,
} from "../objects/role/changes/role.privilege.ts";
import type { Constraint, CustomConstraint } from "./types.ts";

/**
 * Ensure ALTER DEFAULT PRIVILEGES comes before CREATE statements.
 *
 * Excludes CREATE ROLE and CREATE SCHEMA since they are dependencies
 * of ALTER DEFAULT PRIVILEGES and must come before it.
 */
function defaultPrivilegesBeforeCreate(
  a: Change,
  b: Change,
): "a_before_b" | undefined {
  const aIsDefaultPriv =
    a instanceof GrantRoleDefaultPrivileges ||
    a instanceof RevokeRoleDefaultPrivileges;
  const bIsCreate = b.operation === "create" && b.scope === "object";

  // Exclude CREATE ROLE and CREATE SCHEMA since they are dependencies
  // of ALTER DEFAULT PRIVILEGES and must come before it
  const bIsRoleOrSchema =
    bIsCreate && (b.objectType === "role" || b.objectType === "schema");
  if (aIsDefaultPriv && bIsCreate && !bIsRoleOrSchema) {
    return "a_before_b";
  }

  return undefined;
}

/**
 * All custom constraints.
 *
 * Add new constraints here to extend the sorting behavior.
 */
export const customConstraints: CustomConstraint[] = [
  defaultPrivilegesBeforeCreate,
];

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
          source: "custom",
        });
      }
    }
  }

  return constraints;
}
