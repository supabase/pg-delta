import type { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import { diffObjects } from "../../base.diff.ts";
import {
  diffPrivileges,
  filterPublicBuiltInDefaults,
  groupPrivilegesByGrantable,
} from "../../base.privilege-diff.ts";
import type { Role } from "../../role/role.model.ts";
import {
  AlterServerChangeOwner,
  AlterServerSetOptions,
  AlterServerSetVersion,
} from "./changes/server.alter.ts";
import {
  CreateCommentOnServer,
  DropCommentOnServer,
} from "./changes/server.comment.ts";
import { CreateServer } from "./changes/server.create.ts";
import { DropServer } from "./changes/server.drop.ts";
import {
  GrantServerPrivileges,
  RevokeGrantOptionServerPrivileges,
  RevokeServerPrivileges,
} from "./changes/server.privilege.ts";
import type { ServerChange } from "./changes/server.types.ts";
import type { Server } from "./server.model.ts";

/**
 * Diff two sets of servers from main and branch catalogs.
 *
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The servers in the main catalog.
 * @param branch - The servers in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffServers(
  ctx: {
    version: number;
    currentUser: string;
    defaultPrivilegeState: DefaultPrivilegeState;
    mainRoles: Record<string, Role>;
  },
  main: Record<string, Server>,
  branch: Record<string, Server>,
): ServerChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: ServerChange[] = [];

  for (const serverId of created) {
    const createdServer = branch[serverId];
    changes.push(new CreateServer({ server: createdServer }));

    // OWNER: If the server should be owned by someone other than the current user,
    // emit ALTER SERVER ... OWNER TO after creation
    if (createdServer.owner !== ctx.currentUser) {
      changes.push(
        new AlterServerChangeOwner({
          server: createdServer,
          owner: createdServer.owner,
        }),
      );
    }

    if (createdServer.comment !== null) {
      changes.push(new CreateCommentOnServer({ server: createdServer }));
    }

    // PRIVILEGES: Servers don't have default privileges
    const effectiveDefaults: Array<{
      grantee: string;
      privilege: string;
      grantable: boolean;
    }> = [];
    const desiredPrivileges = filterPublicBuiltInDefaults(
      "server",
      createdServer.privileges,
    );
    const privilegeResults = diffPrivileges(
      effectiveDefaults,
      desiredPrivileges,
      createdServer.owner,
      ctx.mainRoles,
    );

    // Generate grant changes
    for (const [grantee, result] of privilegeResults) {
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantServerPrivileges({
              server: createdServer,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke changes
      if (result.revokes.length > 0) {
        const revokeGroups = groupPrivilegesByGrantable(result.revokes);
        for (const [grantable, list] of revokeGroups) {
          void grantable;
          changes.push(
            new RevokeServerPrivileges({
              server: createdServer,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke grant option changes
      if (result.revokeGrantOption.length > 0) {
        changes.push(
          new RevokeGrantOptionServerPrivileges({
            server: createdServer,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }
  }

  for (const serverId of dropped) {
    changes.push(new DropServer({ server: main[serverId] }));
  }

  for (const serverId of altered) {
    const mainServer = main[serverId];
    const branchServer = branch[serverId];

    // OWNER
    if (mainServer.owner !== branchServer.owner) {
      changes.push(
        new AlterServerChangeOwner({
          server: mainServer,
          owner: branchServer.owner,
        }),
      );
    }

    // TYPE - if changed, need to recreate (not directly alterable)
    if (mainServer.type !== branchServer.type) {
      changes.push(new DropServer({ server: mainServer }));
      changes.push(new CreateServer({ server: branchServer }));
      if (branchServer.comment !== null) {
        changes.push(new CreateCommentOnServer({ server: branchServer }));
      }
      continue;
    }

    // VERSION
    if (mainServer.version !== branchServer.version) {
      changes.push(
        new AlterServerSetVersion({
          server: mainServer,
          version: branchServer.version,
        }),
      );
    }

    // OPTIONS
    const optionsChanged = diffOptions(
      mainServer.options,
      branchServer.options,
    );
    if (optionsChanged.length > 0) {
      changes.push(
        new AlterServerSetOptions({
          server: mainServer,
          options: optionsChanged,
        }),
      );
    }

    // COMMENT
    if (mainServer.comment !== branchServer.comment) {
      if (branchServer.comment === null) {
        changes.push(new DropCommentOnServer({ server: mainServer }));
      } else {
        changes.push(new CreateCommentOnServer({ server: branchServer }));
      }
    }

    // PRIVILEGES
    const mainPrivilegesFiltered = filterPublicBuiltInDefaults(
      "server",
      mainServer.privileges,
    );
    const branchPrivilegesFiltered = filterPublicBuiltInDefaults(
      "server",
      branchServer.privileges,
    );
    const privilegeResults = diffPrivileges(
      mainPrivilegesFiltered,
      branchPrivilegesFiltered,
      branchServer.owner,
      ctx.mainRoles,
    );

    for (const [grantee, result] of privilegeResults) {
      // Generate grant changes
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantServerPrivileges({
              server: branchServer,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke changes
      if (result.revokes.length > 0) {
        const revokeGroups = groupPrivilegesByGrantable(result.revokes);
        for (const [grantable, list] of revokeGroups) {
          void grantable;
          changes.push(
            new RevokeServerPrivileges({
              server: mainServer,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke grant option changes
      if (result.revokeGrantOption.length > 0) {
        changes.push(
          new RevokeGrantOptionServerPrivileges({
            server: mainServer,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }

    // Note: Server renaming would also use ALTER SERVER ... RENAME TO ...
    // But since our Server model uses 'name' as the identity field,
    // a name change would be handled as drop + create by diffObjects()
  }

  return changes;
}

/**
 * Diff options arrays to determine ADD/SET/DROP operations.
 * Options are stored as [key1, value1, key2, value2, ...]
 */
function diffOptions(
  mainOptions: string[] | null,
  branchOptions: string[] | null,
): Array<{ action: "ADD" | "SET" | "DROP"; option: string; value?: string }> {
  const mainMap = new Map<string, string>();
  const branchMap = new Map<string, string>();

  // Parse main options
  if (mainOptions) {
    for (let i = 0; i < mainOptions.length; i += 2) {
      if (i + 1 < mainOptions.length) {
        mainMap.set(mainOptions[i], mainOptions[i + 1]);
      }
    }
  }

  // Parse branch options
  if (branchOptions) {
    for (let i = 0; i < branchOptions.length; i += 2) {
      if (i + 1 < branchOptions.length) {
        branchMap.set(branchOptions[i], branchOptions[i + 1]);
      }
    }
  }

  const changes: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }> = [];

  // Find options to ADD or SET
  for (const [key, value] of branchMap) {
    const mainValue = mainMap.get(key);
    if (mainValue === undefined) {
      changes.push({ action: "ADD", option: key, value });
    } else if (mainValue !== value) {
      changes.push({ action: "SET", option: key, value });
    }
  }

  // Find options to DROP
  for (const [key] of mainMap) {
    if (!branchMap.has(key)) {
      changes.push({ action: "DROP", option: key });
    }
  }

  return changes;
}
