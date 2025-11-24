import type { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import { diffObjects } from "../../base.diff.ts";
import {
  diffPrivileges,
  filterPublicBuiltInDefaults,
  groupPrivilegesByGrantable,
} from "../../base.privilege-diff.ts";
import type { Role } from "../../role/role.model.ts";
import {
  AlterForeignTableAddColumn,
  AlterForeignTableAlterColumnDropDefault,
  AlterForeignTableAlterColumnDropNotNull,
  AlterForeignTableAlterColumnSetDefault,
  AlterForeignTableAlterColumnSetNotNull,
  AlterForeignTableAlterColumnType,
  AlterForeignTableChangeOwner,
  AlterForeignTableDropColumn,
  AlterForeignTableSetOptions,
} from "./changes/foreign-table.alter.ts";
import {
  CreateCommentOnForeignTable,
  DropCommentOnForeignTable,
} from "./changes/foreign-table.comment.ts";
import { CreateForeignTable } from "./changes/foreign-table.create.ts";
import { DropForeignTable } from "./changes/foreign-table.drop.ts";
import {
  GrantForeignTablePrivileges,
  RevokeForeignTablePrivileges,
  RevokeGrantOptionForeignTablePrivileges,
} from "./changes/foreign-table.privilege.ts";
import type { ForeignTableChange } from "./changes/foreign-table.types.ts";
import type { ForeignTable } from "./foreign-table.model.ts";

/**
 * Diff two sets of foreign tables from main and branch catalogs.
 *
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The foreign tables in the main catalog.
 * @param branch - The foreign tables in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffForeignTables(
  ctx: {
    version: number;
    currentUser: string;
    defaultPrivilegeState: DefaultPrivilegeState;
    mainRoles: Record<string, Role>;
  },
  main: Record<string, ForeignTable>,
  branch: Record<string, ForeignTable>,
): ForeignTableChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: ForeignTableChange[] = [];

  for (const tableId of created) {
    const createdTable = branch[tableId];
    changes.push(new CreateForeignTable({ foreignTable: createdTable }));

    // OWNER: If the table should be owned by someone other than the current user,
    // emit ALTER FOREIGN TABLE ... OWNER TO after creation
    if (createdTable.owner !== ctx.currentUser) {
      changes.push(
        new AlterForeignTableChangeOwner({
          foreignTable: createdTable,
          owner: createdTable.owner,
        }),
      );
    }

    if (createdTable.comment !== null) {
      changes.push(
        new CreateCommentOnForeignTable({ foreignTable: createdTable }),
      );
    }

    // PRIVILEGES: For created objects, compare against default privileges state
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "foreign_table",
      createdTable.schema ?? "",
    );
    const desiredPrivileges = filterPublicBuiltInDefaults(
      "foreign_table",
      createdTable.privileges,
    );
    const privilegeResults = diffPrivileges(
      effectiveDefaults,
      desiredPrivileges,
      createdTable.owner,
      ctx.mainRoles,
    );

    // Generate grant changes
    for (const [grantee, result] of privilegeResults) {
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantForeignTablePrivileges({
              foreignTable: createdTable,
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
            new RevokeForeignTablePrivileges({
              foreignTable: createdTable,
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
          new RevokeGrantOptionForeignTablePrivileges({
            foreignTable: createdTable,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }
  }

  for (const tableId of dropped) {
    changes.push(new DropForeignTable({ foreignTable: main[tableId] }));
  }

  for (const tableId of altered) {
    const mainTable = main[tableId];
    const branchTable = branch[tableId];

    // OWNER
    if (mainTable.owner !== branchTable.owner) {
      changes.push(
        new AlterForeignTableChangeOwner({
          foreignTable: mainTable,
          owner: branchTable.owner,
        }),
      );
    }

    // SERVER - if changed, need to recreate (not directly alterable)
    if (mainTable.server !== branchTable.server) {
      changes.push(new DropForeignTable({ foreignTable: mainTable }));
      changes.push(new CreateForeignTable({ foreignTable: branchTable }));
      if (branchTable.comment !== null) {
        changes.push(
          new CreateCommentOnForeignTable({ foreignTable: branchTable }),
        );
      }
      continue;
    }

    // COLUMNS
    const mainColumnsByName = new Map(
      mainTable.columns.map((c) => [c.name, c]),
    );
    const branchColumnsByName = new Map(
      branchTable.columns.map((c) => [c.name, c]),
    );

    // Added columns
    for (const [name, col] of branchColumnsByName) {
      if (!mainColumnsByName.has(name)) {
        changes.push(
          new AlterForeignTableAddColumn({
            foreignTable: mainTable,
            column: col,
          }),
        );
      }
    }

    // Dropped columns
    for (const [name] of mainColumnsByName) {
      if (!branchColumnsByName.has(name)) {
        changes.push(
          new AlterForeignTableDropColumn({
            foreignTable: mainTable,
            columnName: name,
          }),
        );
      }
    }

    // Altered columns
    for (const [name, mainCol] of mainColumnsByName) {
      const branchCol = branchColumnsByName.get(name);
      if (!branchCol) continue;

      // Type change
      if (mainCol.data_type_str !== branchCol.data_type_str) {
        changes.push(
          new AlterForeignTableAlterColumnType({
            foreignTable: mainTable,
            columnName: name,
            dataType: branchCol.data_type_str,
          }),
        );
      }

      // Default change
      if (mainCol.default !== branchCol.default) {
        if (branchCol.default === null) {
          changes.push(
            new AlterForeignTableAlterColumnDropDefault({
              foreignTable: mainTable,
              columnName: name,
            }),
          );
        } else {
          changes.push(
            new AlterForeignTableAlterColumnSetDefault({
              foreignTable: mainTable,
              columnName: name,
              defaultValue: branchCol.default,
            }),
          );
        }
      }

      // NOT NULL change
      if (mainCol.not_null !== branchCol.not_null) {
        if (branchCol.not_null) {
          changes.push(
            new AlterForeignTableAlterColumnSetNotNull({
              foreignTable: mainTable,
              columnName: name,
            }),
          );
        } else {
          changes.push(
            new AlterForeignTableAlterColumnDropNotNull({
              foreignTable: mainTable,
              columnName: name,
            }),
          );
        }
      }
    }

    // OPTIONS
    const optionsChanged = diffOptions(mainTable.options, branchTable.options);
    if (optionsChanged.length > 0) {
      changes.push(
        new AlterForeignTableSetOptions({
          foreignTable: mainTable,
          options: optionsChanged,
        }),
      );
    }

    // COMMENT
    if (mainTable.comment !== branchTable.comment) {
      if (branchTable.comment === null) {
        changes.push(
          new DropCommentOnForeignTable({ foreignTable: mainTable }),
        );
      } else {
        changes.push(
          new CreateCommentOnForeignTable({ foreignTable: branchTable }),
        );
      }
    }

    // PRIVILEGES
    const mainPrivilegesFiltered = filterPublicBuiltInDefaults(
      "foreign_table",
      mainTable.privileges,
    );
    const branchPrivilegesFiltered = filterPublicBuiltInDefaults(
      "foreign_table",
      branchTable.privileges,
    );
    const privilegeResults = diffPrivileges(
      mainPrivilegesFiltered,
      branchPrivilegesFiltered,
      branchTable.owner,
      ctx.mainRoles,
    );

    for (const [grantee, result] of privilegeResults) {
      // Generate grant changes
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantForeignTablePrivileges({
              foreignTable: branchTable,
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
            new RevokeForeignTablePrivileges({
              foreignTable: mainTable,
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
          new RevokeGrantOptionForeignTablePrivileges({
            foreignTable: mainTable,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }

    // Note: Foreign table renaming would also use ALTER FOREIGN TABLE ... RENAME TO ...
    // But since our ForeignTable model uses 'name' as the identity field,
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
