import z from "zod";

/**
 * Privilege properties that all privilege objects share.
 */
export const privilegePropsSchema = z.object({
  grantee: z.string(),
  privilege: z.string(),
  grantable: z.boolean(),
  columns: z.array(z.string()).nullable().optional(),
});

export type PrivilegeProps = z.infer<typeof privilegePropsSchema>;

/**
 * Result of privilege diffing for a single grantee
 */
interface PrivilegeDiffResult<T extends PrivilegeProps> {
  grants: T[];
  revokes: T[];
  revokeGrantOption: string[];
}

/**
 * Groups privileges by grantee for efficient diffing
 */
function groupPrivilegesByGrantee<T extends PrivilegeProps>(
  privileges: T[],
): Map<string, T[]> {
  const byGrantee = new Map<string, T[]>();

  for (const privilege of privileges) {
    const existing = byGrantee.get(privilege.grantee) || [];
    existing.push(privilege);
    byGrantee.set(privilege.grantee, existing);
  }

  return byGrantee;
}

/**
 * Diffs privileges for a single grantee between main and branch
 */
function diffPrivilegesForGrantee<T extends PrivilegeProps>(
  mainPrivs: T[],
  branchPrivs: T[],
): PrivilegeDiffResult<T> {
  // Create comparison key - always include columns (null for object-level privileges)
  const toKey = (p: T) => {
    const cols = p.columns || [];
    return `${p.privilege}:${p.grantable}:${cols.sort().join(",")}`;
  };

  // Create key-to-object mappings to retain original data structures
  const mainKeyToObj = new Map(mainPrivs.map((p) => [toKey(p), p]));
  const branchKeyToObj = new Map(branchPrivs.map((p) => [toKey(p), p]));

  const aSet = new Set(mainPrivs.map(toKey));
  const bSet = new Set(branchPrivs.map(toKey));

  const grants: T[] = [];
  const revokes: T[] = [];
  const revokeGrantOption: string[] = [];

  // Find privileges to grant
  for (const key of bSet) {
    if (!aSet.has(key)) {
      const obj = branchKeyToObj.get(key);
      if (obj) grants.push(obj);
    }
  }

  // Find privileges to revoke
  for (const key of aSet) {
    if (!bSet.has(key)) {
      const obj = mainKeyToObj.get(key);
      if (!obj) continue;

      const wasGrantable = obj.grantable;

      // Upgrade: base -> with grant option (no base revoke)
      const upgradedKey = key.replace(":false", ":true");
      const upgraded = !wasGrantable && bSet.has(upgradedKey);
      if (upgraded) continue;

      // If only grantable flipped from true to false, emit REVOKE GRANT OPTION FOR
      const stillHasBase = checkStillHasBase(branchPrivs, obj.privilege, key);
      if (wasGrantable && stillHasBase) {
        revokeGrantOption.push(obj.privilege);
      } else {
        revokes.push(obj);
      }
    }
  }

  return { grants, revokes, revokeGrantOption };
}

/**
 * Check if a privilege still exists in the target set
 */
function checkStillHasBase<T extends PrivilegeProps>(
  targetPrivs: T[],
  privilege: string,
  key: string,
): boolean {
  const [, , columnsStr] = key.split(":");
  return targetPrivs.some(
    (p) =>
      p.privilege === privilege &&
      (p.columns || []).sort().join(",") === columnsStr,
  );
}

/**
 * Groups privileges by grantable flag for efficient SQL generation
 */
export function groupPrivilegesByGrantable<T extends PrivilegeProps>(
  privileges: T[],
): Map<boolean, T[]> {
  const groups = new Map<boolean, T[]>();

  for (const privilege of privileges) {
    const arr = groups.get(privilege.grantable) ?? [];
    arr.push(privilege);
    groups.set(privilege.grantable, arr);
  }

  return groups;
}

/**
 * Groups privileges by columns and grantable flag
 */
export function groupPrivilegesByColumns<T extends PrivilegeProps>(
  privileges: T[],
): Map<string, { columns?: string[]; byGrant: Map<boolean, Set<string>> }> {
  const groups = new Map<
    string,
    { columns?: string[]; byGrant: Map<boolean, Set<string>> }
  >();

  for (const privilege of privileges) {
    const key = privilege.columns ? privilege.columns.sort().join(",") : "";

    if (!groups.has(key)) {
      groups.set(key, {
        columns: privilege.columns ? [...privilege.columns] : undefined,
        byGrant: new Map(),
      });
    }

    const group = groups.get(key);
    if (!group) continue;

    if (!group.byGrant.has(privilege.grantable)) {
      group.byGrant.set(privilege.grantable, new Set());
    }

    const privSet = group.byGrant.get(privilege.grantable);
    if (!privSet) continue;

    privSet.add(privilege.privilege);
  }

  return groups;
}

/**
 * Generic privilege diffing function that works for any object type
 */
export function diffPrivileges<T extends PrivilegeProps>(
  mainPrivileges: T[],
  branchPrivileges: T[],
): Map<string, PrivilegeDiffResult<T>> {
  const mainByGrantee = groupPrivilegesByGrantee(mainPrivileges);
  const branchByGrantee = groupPrivilegesByGrantee(branchPrivileges);

  // Get all grantees
  const allGrantees = new Set([
    ...mainByGrantee.keys(),
    ...branchByGrantee.keys(),
  ]);

  const results = new Map<string, PrivilegeDiffResult<T>>();

  for (const grantee of allGrantees) {
    const mainPrivs = mainByGrantee.get(grantee) || [];
    const branchPrivs = branchByGrantee.get(grantee) || [];

    const result = diffPrivilegesForGrantee(mainPrivs, branchPrivs);
    results.set(grantee, result);
  }

  return results;
}
