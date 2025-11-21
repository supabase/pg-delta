import { diffObjects } from "../base.diff.ts";
import {
  AlterRoleSetConfig,
  AlterRoleSetOptions,
} from "./changes/role.alter.ts";
import {
  CreateCommentOnRole,
  DropCommentOnRole,
} from "./changes/role.comment.ts";
import { CreateRole } from "./changes/role.create.ts";
import { DropRole } from "./changes/role.drop.ts";
import {
  GrantRoleDefaultPrivileges,
  GrantRoleMembership,
  RevokeRoleDefaultPrivileges,
  RevokeRoleMembership,
  RevokeRoleMembershipOptions,
} from "./changes/role.privilege.ts";
import type { RoleChange } from "./changes/role.types.ts";
import type { Role } from "./role.model.ts";

/**
 * Diff two sets of roles from main and branch catalogs.
 *
 * @param ctx - Context containing version information.
 * @param main - The roles in the main catalog.
 * @param branch - The roles in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffRoles(
  ctx: { version: number },
  main: Record<string, Role>,
  branch: Record<string, Role>,
): RoleChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: RoleChange[] = [];

  for (const roleId of created) {
    const role = branch[roleId];
    changes.push(new CreateRole({ role }));
    // Initialize config after creation: one SET per key
    const cfg = role.config ?? [];
    for (const opt of cfg) {
      const eqIndex = opt.indexOf("=");
      if (eqIndex === -1) continue;
      const key = opt.slice(0, eqIndex).trim();
      const value = opt.slice(eqIndex + 1).trim();
      changes.push(new AlterRoleSetConfig({ role, action: "set", key, value }));
    }
    if (role.comment !== null) {
      changes.push(new CreateCommentOnRole({ role }));
    }
    // MEMBERSHIPS: Grant memberships immediately after role creation
    for (const membership of role.members) {
      changes.push(
        new GrantRoleMembership({
          role,
          member: membership.member,
          options: {
            admin: membership.admin_option,
            inherit: membership.inherit_option ?? null,
            set: membership.set_option ?? null,
          },
        }),
      );
    }
    // DEFAULT PRIVILEGES: Grant default privileges immediately after role creation
    for (const defaultPriv of role.default_privileges) {
      if (defaultPriv.privileges.length === 0) continue;
      const grantGroups = new Map<
        boolean,
        { privilege: string; grantable: boolean }[]
      >();
      for (const p of defaultPriv.privileges) {
        const arr = grantGroups.get(p.grantable) ?? [];
        arr.push(p);
        grantGroups.set(p.grantable, arr);
      }
      for (const [grantable, list] of grantGroups) {
        void grantable;
        changes.push(
          new GrantRoleDefaultPrivileges({
            role,
            inSchema: defaultPriv.in_schema,
            objtype: defaultPriv.objtype,
            grantee: defaultPriv.grantee,
            privileges: list,
            version: ctx.version,
          }),
        );
      }
    }
  }

  for (const roleId of dropped) {
    changes.push(new DropRole({ role: main[roleId] }));
  }

  for (const roleId of altered) {
    const mainRole = main[roleId];
    const branchRole = branch[roleId];

    // Use ALTER for flag and connection limit changes, only if any option changed
    const optionsChanged =
      mainRole.is_superuser !== branchRole.is_superuser ||
      mainRole.can_create_databases !== branchRole.can_create_databases ||
      mainRole.can_create_roles !== branchRole.can_create_roles ||
      mainRole.can_inherit !== branchRole.can_inherit ||
      mainRole.can_login !== branchRole.can_login ||
      mainRole.can_replicate !== branchRole.can_replicate ||
      mainRole.can_bypass_rls !== branchRole.can_bypass_rls ||
      mainRole.connection_limit !== branchRole.connection_limit;

    if (optionsChanged) {
      const options: string[] = [];
      if (mainRole.is_superuser !== branchRole.is_superuser) {
        options.push(branchRole.is_superuser ? "SUPERUSER" : "NOSUPERUSER");
      }
      if (mainRole.can_create_databases !== branchRole.can_create_databases) {
        options.push(
          branchRole.can_create_databases ? "CREATEDB" : "NOCREATEDB",
        );
      }
      if (mainRole.can_create_roles !== branchRole.can_create_roles) {
        options.push(
          branchRole.can_create_roles ? "CREATEROLE" : "NOCREATEROLE",
        );
      }
      if (mainRole.can_inherit !== branchRole.can_inherit) {
        options.push(branchRole.can_inherit ? "INHERIT" : "NOINHERIT");
      }
      if (mainRole.can_login !== branchRole.can_login) {
        options.push(branchRole.can_login ? "LOGIN" : "NOLOGIN");
      }
      if (mainRole.can_replicate !== branchRole.can_replicate) {
        options.push(
          branchRole.can_replicate ? "REPLICATION" : "NOREPLICATION",
        );
      }
      if (mainRole.can_bypass_rls !== branchRole.can_bypass_rls) {
        options.push(branchRole.can_bypass_rls ? "BYPASSRLS" : "NOBYPASSRLS");
      }
      if (mainRole.connection_limit !== branchRole.connection_limit) {
        options.push(`CONNECTION LIMIT ${branchRole.connection_limit}`);
      }
      changes.push(new AlterRoleSetOptions({ role: mainRole, options }));
    }

    // CONFIG SET/RESET (emit single-statement changes)
    const parseOptions = (options: string[] | null | undefined) => {
      const map = new Map<string, string>();
      if (!options) return map;
      for (const opt of options) {
        const eqIndex = opt.indexOf("=");
        if (eqIndex === -1) continue;
        const key = opt.slice(0, eqIndex).trim();
        const value = opt.slice(eqIndex + 1).trim();
        map.set(key, value);
      }
      return map;
    };

    const mainMap = parseOptions(mainRole.config);
    const branchMap = parseOptions(branchRole.config);

    if (mainMap.size > 0 && branchMap.size === 0) {
      // All settings removed -> prefer RESET ALL
      changes.push(
        new AlterRoleSetConfig({ role: mainRole, action: "reset_all" }),
      );
    } else {
      // Removed or changed keys -> RESET key
      for (const [key, oldValue] of mainMap.entries()) {
        const hasInBranch = branchMap.has(key);
        const newValue = branchMap.get(key);
        const changed = hasInBranch ? oldValue !== newValue : true;
        if (changed) {
          changes.push(
            new AlterRoleSetConfig({ role: mainRole, action: "reset", key }),
          );
        }
      }

      // Added or changed keys -> SET key TO value
      for (const [key, newValue] of branchMap.entries()) {
        const oldValue = mainMap.get(key);
        if (oldValue !== newValue) {
          changes.push(
            new AlterRoleSetConfig({
              role: mainRole,
              action: "set",
              key,
              value: newValue,
            }),
          );
        }
      }
    }

    // COMMENT
    if (mainRole.comment !== branchRole.comment) {
      if (branchRole.comment === null) {
        changes.push(new DropCommentOnRole({ role: mainRole }));
      } else {
        changes.push(new CreateCommentOnRole({ role: branchRole }));
      }
    }

    // MEMBERSHIPS
    const mainMembers = new Map(mainRole.members.map((m) => [m.member, m]));
    const branchMembers = new Map(branchRole.members.map((m) => [m.member, m]));

    // Find new members to grant
    for (const [member, membership] of branchMembers) {
      if (!mainMembers.has(member)) {
        changes.push(
          new GrantRoleMembership({
            role: branchRole,
            member: membership.member,
            options: {
              admin: membership.admin_option,
              inherit: membership.inherit_option ?? null,
              set: membership.set_option ?? null,
            },
          }),
        );
      }
    }

    // Find members to revoke
    for (const [member, membership] of mainMembers) {
      if (!branchMembers.has(member)) {
        changes.push(
          new RevokeRoleMembership({
            role: mainRole,
            member: membership.member,
          }),
        );
      }
    }

    // Find membership option changes
    for (const [member, branchMembership] of branchMembers) {
      const mainMembership = mainMembers.get(member);
      if (mainMembership) {
        const toRevoke: { admin?: boolean; inherit?: boolean; set?: boolean } =
          {};
        const toGrant: { admin?: boolean; inherit?: boolean; set?: boolean } =
          {};

        if (mainMembership.admin_option !== branchMembership.admin_option) {
          if (branchMembership.admin_option) toGrant.admin = true;
          else toRevoke.admin = true;
        }
        if (
          (mainMembership.inherit_option ?? null) !==
          (branchMembership.inherit_option ?? null)
        ) {
          if (branchMembership.inherit_option) toGrant.inherit = true;
          else toRevoke.inherit = true;
        }
        if (
          (mainMembership.set_option ?? null) !==
          (branchMembership.set_option ?? null)
        ) {
          if (branchMembership.set_option) toGrant.set = true;
          else toRevoke.set = true;
        }

        if (toRevoke.admin || toRevoke.inherit || toRevoke.set) {
          changes.push(
            new RevokeRoleMembershipOptions({
              role: mainRole,
              member: mainMembership.member,
              admin: toRevoke.admin,
              inherit: toRevoke.inherit,
              set: toRevoke.set,
            }),
          );
        }
        if (toGrant.admin || toGrant.inherit || toGrant.set) {
          changes.push(
            new GrantRoleMembership({
              role: branchRole,
              member: branchMembership.member,
              options: {
                admin: !!toGrant.admin,
                inherit: toGrant.inherit ?? null,
                set: toGrant.set ?? null,
              },
            }),
          );
        }
      }
    }

    // DEFAULT PRIVILEGES
    const mainDefaultPrivs = new Map(
      mainRole.default_privileges.map((dp) => [
        `${dp.in_schema ?? ""}:${dp.objtype}:${dp.grantee}`,
        dp,
      ]),
    );
    const branchDefaultPrivs = new Map(
      branchRole.default_privileges.map((dp) => [
        `${dp.in_schema ?? ""}:${dp.objtype}:${dp.grantee}`,
        dp,
      ]),
    );

    // Find new default privileges to grant
    for (const [key, defaultPriv] of branchDefaultPrivs) {
      if (!mainDefaultPrivs.has(key)) {
        if (defaultPriv.privileges.length === 0) continue;
        const grantGroups = new Map<
          boolean,
          { privilege: string; grantable: boolean }[]
        >();
        for (const p of defaultPriv.privileges) {
          const arr = grantGroups.get(p.grantable) ?? [];
          arr.push(p);
          grantGroups.set(p.grantable, arr);
        }
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantRoleDefaultPrivileges({
              role: branchRole,
              inSchema: defaultPriv.in_schema,
              objtype: defaultPriv.objtype,
              grantee: defaultPriv.grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }
    }

    // Find default privileges to revoke
    for (const [key, defaultPriv] of mainDefaultPrivs) {
      if (!branchDefaultPrivs.has(key)) {
        if (defaultPriv.privileges.length === 0) continue;
        const revokeGroups = new Map<
          boolean,
          { privilege: string; grantable: boolean }[]
        >();
        for (const p of defaultPriv.privileges) {
          const arr = revokeGroups.get(p.grantable) ?? [];
          arr.push(p);
          revokeGroups.set(p.grantable, arr);
        }
        for (const [grantable, list] of revokeGroups) {
          void grantable;
          changes.push(
            new RevokeRoleDefaultPrivileges({
              role: mainRole,
              inSchema: defaultPriv.in_schema,
              objtype: defaultPriv.objtype,
              grantee: defaultPriv.grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }
    }

    // Find default privilege changes
    for (const [key, branchDefaultPriv] of branchDefaultPrivs) {
      const mainDefaultPriv = mainDefaultPrivs.get(key);
      if (mainDefaultPriv) {
        const toKey = (p: { privilege: string; grantable: boolean }) =>
          `${p.privilege}:${p.grantable}`;
        const mainSet = new Set(mainDefaultPriv.privileges.map(toKey));
        const branchSet = new Set(branchDefaultPriv.privileges.map(toKey));

        const grants: { privilege: string; grantable: boolean }[] = [];
        const revokes: { privilege: string; grantable: boolean }[] = [];
        const revokeGrantOption: string[] = [];

        for (const key of branchSet) {
          if (!mainSet.has(key)) {
            const [privilege, grantableStr] = key.split(":");
            grants.push({ privilege, grantable: grantableStr === "true" });
          }
        }
        for (const key of mainSet) {
          if (!branchSet.has(key)) {
            const [privilege, grantableStr] = key.split(":");
            const wasGrantable = grantableStr === "true";
            const stillHasBase = branchDefaultPriv.privileges.some(
              (p) => p.privilege === privilege,
            );
            const upgraded =
              !wasGrantable && branchSet.has(`${privilege}:true`);
            if (upgraded) {
              // base -> with grant option; do not revoke base
              continue;
            }
            if (wasGrantable && stillHasBase) {
              revokeGrantOption.push(privilege);
            } else {
              revokes.push({ privilege, grantable: wasGrantable });
            }
          }
        }

        if (grants.length > 0) {
          const grantGroups = new Map<
            boolean,
            { privilege: string; grantable: boolean }[]
          >();
          for (const p of grants) {
            const arr = grantGroups.get(p.grantable) ?? [];
            arr.push(p);
            grantGroups.set(p.grantable, arr);
          }
          for (const [grantable, list] of grantGroups) {
            void grantable;
            changes.push(
              new GrantRoleDefaultPrivileges({
                role: branchRole,
                inSchema: branchDefaultPriv.in_schema,
                objtype: branchDefaultPriv.objtype,
                grantee: branchDefaultPriv.grantee,
                privileges: list,
                version: ctx.version,
              }),
            );
          }
        }
        if (revokes.length > 0) {
          const revokeGroups = new Map<
            boolean,
            { privilege: string; grantable: boolean }[]
          >();
          for (const p of revokes) {
            const arr = revokeGroups.get(p.grantable) ?? [];
            arr.push(p);
            revokeGroups.set(p.grantable, arr);
          }
          for (const [grantable, list] of revokeGroups) {
            void grantable;
            changes.push(
              new RevokeRoleDefaultPrivileges({
                role: mainRole,
                inSchema: mainDefaultPriv.in_schema,
                objtype: mainDefaultPriv.objtype,
                grantee: mainDefaultPriv.grantee,
                privileges: list,
                version: ctx.version,
              }),
            );
          }
        }
        if (revokeGrantOption.length > 0) {
          // Encode as GRANT OPTION revocation by marking grantable true
          changes.push(
            new RevokeRoleDefaultPrivileges({
              role: mainRole,
              inSchema: mainDefaultPriv.in_schema,
              objtype: mainDefaultPriv.objtype,
              grantee: mainDefaultPriv.grantee,
              privileges: revokeGrantOption.map((p) => ({
                privilege: p,
                grantable: true,
              })),
              version: ctx.version,
            }),
          );
        }
      }
    }
  }

  return changes;
}
