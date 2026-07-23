import z from "zod";
import type { Change } from "../change.types.ts";
import type { BaseChange } from "./base.change.ts";

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
function groupPrivilegesByGrantable<T extends PrivilegeProps>(
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
function groupPrivilegesByColumns<T extends PrivilegeProps>(
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
 * Returns the privilege name that PostgreSQL implicitly grants to PUBLIC by
 * default for a given object type (e.g. EXECUTE for procedures/aggregates,
 * USAGE for domains/enums/ranges/composite types/languages), or `null` if the
 * object type has no PUBLIC built-in default.
 *
 * Reference: PostgreSQL 17 Documentation, Table 5.2 "Summary of Access Privileges"
 * https://www.postgresql.org/docs/17/ddl-priv.html
 *
 * Objects with default PUBLIC privileges:
 * - Functions/Procedures/Aggregates: EXECUTE
 * - Types/Domains/Enums/Ranges/Composite Types: USAGE
 * - Languages: USAGE
 *
 * Objects WITHOUT default PUBLIC privileges:
 * - Tables, Views, Materialized Views, Sequences, Schemas, etc.
 */
function getPublicBuiltInDefaultPrivilege(
  objectType: Change["objectType"],
): string | null {
  switch (objectType) {
    case "procedure":
    case "aggregate":
      return "EXECUTE";

    case "domain":
    case "enum":
    case "range":
    case "composite_type":
    case "language":
      return "USAGE";

    default:
      return null;
  }
}

/**
 * Filters out PUBLIC's built-in default privileges that PostgreSQL automatically grants
 * when creating certain object types. This prevents generating unnecessary GRANT statements
 * for privileges that PostgreSQL grants automatically.
 *
 * See {@link getPublicBuiltInDefaultPrivilege} for the object type -> privilege mapping.
 */
export function filterPublicBuiltInDefaults<T extends PrivilegeProps>(
  objectType: Change["objectType"],
  privileges: T[],
): T[] {
  const builtInPrivilege = getPublicBuiltInDefaultPrivilege(objectType);
  if (builtInPrivilege === null) {
    // This object type has no PUBLIC built-in default, so keep all PUBLIC
    // privileges and generate GRANT statements for them.
    return privileges;
  }

  return privileges.filter(
    (priv) => priv.grantee !== "PUBLIC" || priv.privilege !== builtInPrivilege,
  );
}

/**
 * Adds PostgreSQL's implicit PUBLIC built-in default privilege (e.g. EXECUTE
 * for procedures/aggregates, USAGE for domains/enums/ranges/composite
 * types/languages) to a privilege list, unless an entry for that grantee and
 * privilege is already present.
 *
 * `DefaultPrivilegeState.getEffectiveDefaults` only tracks explicit
 * `ALTER DEFAULT PRIVILEGES` customizations, so it never encodes PostgreSQL's
 * hardcoded PUBLIC fallback the way a real ACL does. This helper restores
 * that fallback so the "effective defaults" side of a create-path privilege
 * diff can be compared symmetrically against the desired object's actual
 * (unfiltered) privileges.
 *
 * See {@link getPublicBuiltInDefaultPrivilege} for the object type -> privilege mapping.
 */
export function withPublicBuiltInDefault<T extends PrivilegeProps>(
  objectType: Change["objectType"],
  privileges: T[],
): T[] {
  const builtInPrivilege = getPublicBuiltInDefaultPrivilege(objectType);
  if (builtInPrivilege === null) {
    return privileges;
  }

  const hasDefaultAlready = privileges.some(
    (priv) => priv.grantee === "PUBLIC" && priv.privilege === builtInPrivilege,
  );
  if (hasDefaultAlready) {
    return privileges;
  }

  return [
    ...privileges,
    {
      grantee: "PUBLIC",
      privilege: builtInPrivilege,
      grantable: false,
    } as T,
  ];
}

/**
 * Filter out owner privileges from a privilege list.
 * Owner privileges are implicit (owner always has ALL) and shouldn't be compared.
 */
function filterOwnerPrivileges<T extends PrivilegeProps>(
  privileges: T[],
  owner: string,
): T[] {
  return privileges.filter((p) => p.grantee !== owner);
}

/**
 * Generic privilege diffing function that works for any object type
 */
export function diffPrivileges<T extends PrivilegeProps>(
  mainPrivileges: T[],
  branchPrivileges: T[],
  owner?: string,
): Map<string, PrivilegeDiffResult<T>> {
  // Filter out owner privileges if owner is provided
  const mainFiltered = owner
    ? filterOwnerPrivileges(mainPrivileges, owner)
    : mainPrivileges;
  const branchFiltered = owner
    ? filterOwnerPrivileges(branchPrivileges, owner)
    : branchPrivileges;

  const mainByGrantee = groupPrivilegesByGrantee(mainFiltered);
  const branchByGrantee = groupPrivilegesByGrantee(branchFiltered);

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

// ==== Privilege Change Emission Helpers ====
//
// These helpers convert the output of `diffPrivileges` (per-grantee grant /
// revoke / revoke-grant-option lists) into concrete Change instances so that
// individual object diffs don't have to repeat the same iteration and grouping
// logic.
//
// Callers pass a `PrivilegeChangeFactories` bag containing the three class
// constructors (Grant, Revoke, RevokeGrantOption) for their object type.  The
// helpers instantiate them with a common props shape: an object reference keyed
// by `objectKey`, a `grantee`, `privileges` or `privilegeNames`, an optional
// `version`, and (for column-level privileges) optional `columns`.

/**
 * Factory constructors for Grant / Revoke / RevokeGrantOption change classes.
 * Every object type provides its own concrete classes.  The `any` props type
 * is intentional: the helpers build props with a computed `[objectKey]` key
 * whose name varies per object type, so no single concrete type can unify
 * all call sites without an unsafe cast elsewhere.
 */
interface PrivilegeChangeFactories {
  Grant: new (
    // biome-ignore lint/suspicious/noExplicitAny: factory accepts heterogeneous prop bags keyed by object type
    props: any,
  ) => BaseChange;
  Revoke: new (
    // biome-ignore lint/suspicious/noExplicitAny: factory accepts heterogeneous prop bags keyed by object type
    props: any,
  ) => BaseChange;
  RevokeGrantOption: new (
    // biome-ignore lint/suspicious/noExplicitAny: factory accepts heterogeneous prop bags keyed by object type
    props: any,
  ) => BaseChange;
}

/**
 * Emit privilege changes for object-level privileges (schema, sequence,
 * procedure, etc.).
 *
 * For each grantee in `privilegeResults` the function groups grants and revokes
 * by the `grantable` flag and pushes one change per group.  Revoke-grant-option
 * entries produce a single change carrying `privilegeNames`.
 *
 * `grantTarget` is the *branch* object (the desired state) while `revokeTarget`
 * is the *main* object (the current state), so that GRANTs reference the
 * newly-created/altered object and REVOKEs reference the existing one.
 */
export function emitObjectPrivilegeChanges(
  privilegeResults: Map<string, PrivilegeDiffResult<PrivilegeProps>>,
  grantTarget: unknown,
  revokeTarget: unknown,
  objectKey: string,
  factories: PrivilegeChangeFactories,
  version?: number,
): BaseChange[] {
  const changes: BaseChange[] = [];

  for (const [grantee, result] of privilegeResults) {
    for (const [, revokes] of groupPrivilegesByGrantable(result.revokes)) {
      changes.push(
        new factories.Revoke({
          [objectKey]: revokeTarget,
          privileges: revokes,
          grantee,
          version,
        }),
      );
    }
    if (result.revokeGrantOption.length > 0) {
      changes.push(
        new factories.RevokeGrantOption({
          [objectKey]: revokeTarget,
          privilegeNames: result.revokeGrantOption,
          grantee,
          version,
        }),
      );
    }
    for (const [, grants] of groupPrivilegesByGrantable(result.grants)) {
      changes.push(
        new factories.Grant({
          [objectKey]: grantTarget,
          privileges: grants,
          grantee,
          version,
        }),
      );
    }
  }

  return changes;
}

/**
 * Emit privilege changes for column-level privileges (table, view,
 * materialized view).
 *
 * Like {@link emitObjectPrivilegeChanges} but groups by column set (via
 * `groupPrivilegesByColumns`) instead of only by grantable.  For
 * revoke-grant-option the column sets come from `sourcePrivileges` so that
 * `REVOKE GRANT OPTION FOR` is emitted per column set that originally carried
 * the privilege.
 */
export function emitColumnPrivilegeChanges(
  privilegeResults: Map<string, PrivilegeDiffResult<PrivilegeProps>>,
  grantTarget: unknown,
  revokeTarget: unknown,
  objectKey: string,
  factories: PrivilegeChangeFactories,
  sourcePrivileges: PrivilegeProps[],
  version?: number,
): BaseChange[] {
  const changes: BaseChange[] = [];

  for (const [grantee, result] of privilegeResults) {
    for (const [, group] of groupPrivilegesByColumns(result.revokes)) {
      const allPrivileges = new Set<string>();
      for (const [, privSet] of group.byGrant) {
        for (const priv of privSet) {
          allPrivileges.add(priv);
        }
      }
      changes.push(
        new factories.Revoke({
          [objectKey]: revokeTarget,
          privileges: [...allPrivileges].map((p) => ({
            privilege: p,
            grantable: false,
          })),
          grantee,
          columns: group.columns,
          version,
        }),
      );
    }
    if (result.revokeGrantOption.length > 0) {
      const sourcePrivsForGrantee = sourcePrivileges.filter(
        (p) => p.grantee === grantee,
      );
      for (const [, group] of groupPrivilegesByColumns(
        sourcePrivsForGrantee.filter((p) =>
          result.revokeGrantOption.includes(p.privilege),
        ),
      )) {
        changes.push(
          new factories.RevokeGrantOption({
            [objectKey]: revokeTarget,
            privilegeNames: result.revokeGrantOption,
            grantee,
            columns: group.columns,
            version,
          }),
        );
      }
    }
    for (const [, group] of groupPrivilegesByColumns(result.grants)) {
      for (const [grantable, privSet] of group.byGrant) {
        changes.push(
          new factories.Grant({
            [objectKey]: grantTarget,
            privileges: [...privSet].map((p) => ({ privilege: p, grantable })),
            grantee,
            columns: group.columns,
            version,
          }),
        );
      }
    }
  }

  return changes;
}
