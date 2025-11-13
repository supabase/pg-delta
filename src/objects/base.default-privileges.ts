import type { PrivilegeProps } from "./base.privilege-diff.ts";
import type { Role } from "./role/role.model.ts";

/**
 * Maps object type names to PostgreSQL default privilege objtype codes.
 * Used to look up default privileges for different object types.
 */
function objectTypeToObjtype(objectType: string): string | null {
  switch (objectType) {
    case "table":
      return "r"; // Relations (tables)
    case "view":
      return "r"; // Views are also relations
    case "materialized_view":
      return "r"; // Materialized views are also relations
    case "sequence":
      return "S"; // Sequences
    case "procedure":
    case "function":
    case "aggregate":
      return "f"; // Functions/routines
    case "type":
    case "domain":
    case "enum":
    case "range":
    case "composite_type":
      return "T"; // Types
    case "schema":
      return "n"; // Schemas
    default:
      return null;
  }
}

/**
 * Tracks the effective state of default privileges as changes are processed.
 * This allows us to compute what default privileges would be in effect at any point
 * in the migration script, accounting for ALTER DEFAULT PRIVILEGES statements.
 */
export class DefaultPrivilegeState {
  private state: Map<
    string,
    Map<string, Map<string | null, Map<string, Set<string>>>>
  > = new Map(); // role -> objtype -> schema -> grantee -> privileges

  constructor(initialRoles: Record<string, Role>) {
    // Initialize state from roles' default_privileges
    for (const [_roleId, role] of Object.entries(initialRoles)) {
      const roleName = role.name;
      if (!this.state.has(roleName)) {
        this.state.set(roleName, new Map());
      }
      // biome-ignore lint/style/noNonNullAssertion: roleName is guaranteed to be in the state
      const roleState = this.state.get(roleName)!;

      for (const defPriv of role.default_privileges) {
        if (!roleState.has(defPriv.objtype)) {
          roleState.set(defPriv.objtype, new Map());
        }
        // biome-ignore lint/style/noNonNullAssertion: objtype is guaranteed to be in the state
        const objtypeState = roleState.get(defPriv.objtype)!;

        const schemaKey = defPriv.in_schema ?? null;
        if (!objtypeState.has(schemaKey)) {
          objtypeState.set(schemaKey, new Map());
        }
        // biome-ignore lint/style/noNonNullAssertion: schemaKey is guaranteed to be in the state
        const schemaState = objtypeState.get(schemaKey)!;

        if (!schemaState.has(defPriv.grantee)) {
          schemaState.set(defPriv.grantee, new Set());
        }
        // biome-ignore lint/style/noNonNullAssertion: grantee is guaranteed to be in the state
        const privileges = schemaState.get(defPriv.grantee)!;

        for (const priv of defPriv.privileges) {
          const key = `${priv.privilege}:${priv.grantable}`;
          privileges.add(key);
        }
      }
    }
  }

  /**
   * Apply a GrantRoleDefaultPrivileges change to the state.
   */
  applyGrant(
    roleName: string,
    objtype: string,
    inSchema: string | null,
    grantee: string,
    privileges: { privilege: string; grantable: boolean }[],
  ): void {
    if (!this.state.has(roleName)) {
      this.state.set(roleName, new Map());
    }
    // biome-ignore lint/style/noNonNullAssertion: roleName is guaranteed to be in the state
    const roleState = this.state.get(roleName)!;

    if (!roleState.has(objtype)) {
      roleState.set(objtype, new Map());
    }
    // biome-ignore lint/style/noNonNullAssertion: objtype is guaranteed to be in the state
    const objtypeState = roleState.get(objtype)!;

    const schemaKey = inSchema ?? null;
    if (!objtypeState.has(schemaKey)) {
      objtypeState.set(schemaKey, new Map());
    }
    // biome-ignore lint/style/noNonNullAssertion: schemaKey is guaranteed to be in the state
    const schemaState = objtypeState.get(schemaKey)!;

    if (!schemaState.has(grantee)) {
      schemaState.set(grantee, new Set());
    }
    // biome-ignore lint/style/noNonNullAssertion: grantee is guaranteed to be in the state
    const privilegesSet = schemaState.get(grantee)!;

    for (const priv of privileges) {
      const key = `${priv.privilege}:${priv.grantable}`;
      privilegesSet.add(key);
    }
  }

  /**
   * Apply a RevokeRoleDefaultPrivileges change to the state.
   */
  applyRevoke(
    roleName: string,
    objtype: string,
    inSchema: string | null,
    grantee: string,
    privileges: { privilege: string; grantable: boolean }[],
  ): void {
    const roleState = this.state.get(roleName);
    if (!roleState) return;

    const objtypeState = roleState.get(objtype);
    if (!objtypeState) return;

    const schemaKey = inSchema ?? null;
    const schemaState = objtypeState.get(schemaKey);
    if (!schemaState) return;

    const privilegesSet = schemaState.get(grantee);
    if (!privilegesSet) return;

    for (const priv of privileges) {
      const key = `${priv.privilege}:${priv.grantable}`;
      privilegesSet.delete(key);
      // Also remove base privilege if grantable was revoked
      if (priv.grantable) {
        const baseKey = `${priv.privilege}:false`;
        privilegesSet.delete(baseKey);
      }
    }
  }

  /**
   * Get effective default privileges for a given object creation.
   */
  getEffectiveDefaults(
    currentUser: string,
    objectType: string,
    objectSchema: string,
  ): PrivilegeProps[] {
    const objtype = objectTypeToObjtype(objectType);
    if (!objtype) return [];

    const roleState = this.state.get(currentUser);
    if (!roleState) return [];

    const objtypeState = roleState.get(objtype);
    if (!objtypeState) return [];

    const defaultPrivs: PrivilegeProps[] = [];

    // Check schema-specific first, then global (null schema)
    const schemasToCheck = [objectSchema, null];
    for (const schemaKey of schemasToCheck) {
      const schemaState = objtypeState.get(schemaKey);
      if (!schemaState) continue;

      for (const [grantee, privilegesSet] of schemaState.entries()) {
        for (const privKey of privilegesSet) {
          const [privilege, grantableStr] = privKey.split(":");
          const grantable = grantableStr === "true";
          defaultPrivs.push({
            grantee,
            privilege,
            grantable,
            columns: null,
          });
        }
      }
      // Schema-specific takes precedence, so break after first match
      if (schemaKey === objectSchema && schemaState.size > 0) {
        break;
      }
    }

    return defaultPrivs;
  }
}
