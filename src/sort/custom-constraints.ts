import type { Change } from "../change.types.ts";
import {
  GrantRoleDefaultPrivileges,
  RevokeRoleDefaultPrivileges,
} from "../objects/role/changes/role.privilege.ts";
import type { CustomConstraint } from "./types.ts";

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
