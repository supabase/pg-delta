import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  groupPrivilegesByColumns,
  type PrivilegeProps,
} from "../base.privilege-diff.ts";
import type { Role } from "../role/role.model.ts";
import { deepEqual } from "../utils.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropNotNull,
  AlterTableAlterColumnSetDefault,
  AlterTableAlterColumnSetNotNull,
  AlterTableAlterColumnType,
  AlterTableAttachPartition,
  AlterTableChangeOwner,
  AlterTableDetachPartition,
  AlterTableDisableRowLevelSecurity,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableEnableRowLevelSecurity,
  AlterTableForceRowLevelSecurity,
  AlterTableNoForceRowLevelSecurity,
  AlterTableResetStorageParams,
  AlterTableSetLogged,
  AlterTableSetReplicaIdentity,
  AlterTableSetStorageParams,
  AlterTableSetUnlogged,
  AlterTableValidateConstraint,
} from "./changes/table.alter.ts";
import {
  CreateCommentOnColumn,
  CreateCommentOnConstraint,
  CreateCommentOnTable,
  DropCommentOnColumn,
  DropCommentOnConstraint,
  DropCommentOnTable,
} from "./changes/table.comment.ts";
import { CreateTable } from "./changes/table.create.ts";
import { DropTable } from "./changes/table.drop.ts";
import {
  GrantTablePrivileges,
  RevokeGrantOptionTablePrivileges,
  RevokeTablePrivileges,
} from "./changes/table.privilege.ts";
import type { TableChange } from "./changes/table.types.ts";
import { Table } from "./table.model.js";

function createAlterConstraintChange(
  mainTable: Table,
  branchTable: Table,
  branchCatalog: Record<string, Table>,
) {
  const changes: TableChange[] = [];

  // Note: Table renaming would also use ALTER TABLE ... RENAME TO ...
  // But since our Table model uses 'name' as the identity field,
  // a name change would be handled as drop + create by diffObjects()

  // TABLE CONSTRAINTS
  const mainByName = new Map(
    (mainTable.constraints ?? []).map((c) => [c.name, c]),
  );
  const branchByName = new Map(
    (branchTable.constraints ?? []).map((c) => [c.name, c]),
  );

  // Created constraints
  for (const [name, c] of branchByName) {
    // Skip primary key creation on partitions if parent_table already has one
    if (branchTable.is_partition && c.constraint_type === "p") {
      const parent =
        branchCatalog[
          `table:${branchTable.parent_schema}.${branchTable.parent_name}`
        ];
      const parentHasPrimaryKey = Boolean(
        parent?.constraints?.some((pc) => pc.constraint_type === "p"),
      );
      if (parentHasPrimaryKey) continue;
    }
    if (!mainByName.has(name)) {
      changes.push(
        new AlterTableAddConstraint({
          table: branchTable,
          constraint: c,
        }),
      );
      if (!c.validated) {
        changes.push(
          new AlterTableValidateConstraint({
            table: branchTable,
            constraint: c,
          }),
        );
      }
      // Add comment for newly created constraint
      if (c.comment !== null) {
        changes.push(
          new CreateCommentOnConstraint({
            table: branchTable,
            constraint: c,
          }),
        );
      }
    }
  }

  // Dropped constraints
  for (const [name, c] of mainByName) {
    // Skip primary key drop on partitions if parent_table already has one
    if (branchTable.is_partition && c.constraint_type === "p") {
      const parent =
        branchCatalog[
          `table:${branchTable.parent_schema}.${branchTable.parent_name}`
        ];
      const parentHasPrimaryKey = Boolean(
        parent?.constraints?.some((pc) => pc.constraint_type === "p"),
      );
      if (parentHasPrimaryKey) continue;
    }
    if (!branchByName.has(name)) {
      changes.push(
        new AlterTableDropConstraint({ table: mainTable, constraint: c }),
      );
    }
  }

  // Altered constraints -> drop + add
  for (const [name, mainC] of mainByName) {
    const branchC = branchByName.get(name);
    if (!branchC) continue;
    // Skip any primary key alterations on partitions
    if (branchTable.is_partition && branchC.constraint_type === "p") {
      const parent =
        branchCatalog[
          `table:${branchTable.parent_schema}.${branchTable.parent_name}`
        ];
      const parentHasPrimaryKey = Boolean(
        parent?.constraints?.some((pc) => pc.constraint_type === "p"),
      );
      if (parentHasPrimaryKey) continue;
    }
    const changed =
      mainC.constraint_type !== branchC.constraint_type ||
      mainC.deferrable !== branchC.deferrable ||
      mainC.initially_deferred !== branchC.initially_deferred ||
      mainC.validated !== branchC.validated ||
      mainC.is_local !== branchC.is_local ||
      mainC.no_inherit !== branchC.no_inherit ||
      JSON.stringify(mainC.key_columns) !==
        JSON.stringify(branchC.key_columns) ||
      JSON.stringify(mainC.foreign_key_columns) !==
        JSON.stringify(branchC.foreign_key_columns) ||
      mainC.foreign_key_table !== branchC.foreign_key_table ||
      mainC.foreign_key_schema !== branchC.foreign_key_schema ||
      mainC.on_update !== branchC.on_update ||
      mainC.on_delete !== branchC.on_delete ||
      mainC.match_type !== branchC.match_type ||
      mainC.check_expression !== branchC.check_expression;
    if (changed) {
      changes.push(
        new AlterTableDropConstraint({
          table: mainTable,
          constraint: mainC,
        }),
      );
      changes.push(
        new AlterTableAddConstraint({
          table: branchTable,
          constraint: branchC,
        }),
      );
      if (!branchC.validated) {
        changes.push(
          new AlterTableValidateConstraint({
            table: branchTable,
            constraint: branchC,
          }),
        );
      }
      // Ensure constraint comment is applied after re-creation
      if (branchC.comment !== null) {
        changes.push(
          new CreateCommentOnConstraint({
            table: branchTable,
            constraint: branchC,
          }),
        );
      }
    } else {
      // Comment-only change on constraint
      if (mainC.comment !== branchC.comment) {
        if (branchC.comment === null) {
          changes.push(
            new DropCommentOnConstraint({
              table: mainTable,
              constraint: mainC,
            }),
          );
        } else {
          changes.push(
            new CreateCommentOnConstraint({
              table: branchTable,
              constraint: branchC,
            }),
          );
        }
      }
    }
  }

  return changes;
}

/**
 * Compute default privileges that would be granted when creating a table.
 * This looks at the currentUser's default privileges for tables in the given schema.
 */
function computeDefaultPrivilegesForTable(
  currentUser: string,
  tableSchema: string,
  roles: Record<string, Role>,
): PrivilegeProps[] {
  const currentUserRole = roles[`role:${currentUser}`];
  if (!currentUserRole) return [];

  const defaultPrivs: PrivilegeProps[] = [];

  for (const defPriv of currentUserRole.default_privileges) {
    // Only consider table privileges (objtype "r")
    if (defPriv.objtype !== "r") continue;

    // Match schema-specific or global default privileges
    const matchesSchema =
      defPriv.in_schema === null || defPriv.in_schema === tableSchema;

    if (matchesSchema) {
      // Convert default privilege to PrivilegeProps format
      for (const priv of defPriv.privileges) {
        defaultPrivs.push({
          grantee: defPriv.grantee,
          privilege: priv.privilege,
          grantable: priv.grantable,
          columns: null, // Default privileges are always object-level, not column-level
        });
      }
    }
  }

  return defaultPrivs;
}

/**
 * Diff two sets of tables from main and branch catalogs.
 *
 * @param main - The tables in the main catalog.
 * @param branch - The tables in the branch catalog.
 * @param roles - The roles in the main catalog (used to compute default privileges).
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffTables(
  ctx: { version: number; currentUser: string },
  main: Record<string, Table>,
  branch: Record<string, Table>,
  roles: Record<string, Role>,
): TableChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: TableChange[] = [];

  for (const tableId of created) {
    changes.push(new CreateTable({ table: branch[tableId] }));
    const branchTable = branch[tableId];
    changes.push(
      ...createAlterConstraintChange(
        // Create a dummy table with no constraints do diff constraints against
        new Table({
          ...branchTable,
          constraints: [],
        }),
        branchTable,
        branch,
      ),
    );

    // Table comment on creation
    if (branchTable.comment !== null && branchTable.comment !== undefined) {
      changes.push(new CreateCommentOnTable({ table: branchTable }));
    }

    // Column comments on creation
    for (const col of branchTable.columns) {
      if (col.comment !== null && col.comment !== undefined) {
        changes.push(
          new CreateCommentOnColumn({ table: branchTable, column: col }),
        );
      }
    }

    // PRIVILEGES: Compute default privileges that would be granted and diff against branch
    const defaultPrivileges = computeDefaultPrivilegesForTable(
      ctx.currentUser,
      branchTable.schema,
      roles,
    );
    const privilegeResults = diffPrivileges(
      defaultPrivileges,
      branchTable.privileges,
    );

    for (const [grantee, result] of privilegeResults) {
      // Generate grant changes
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByColumns(result.grants);
        for (const [, group] of grantGroups) {
          for (const [grantable, privSet] of group.byGrant) {
            const privileges = Array.from(privSet).map((priv) => ({
              privilege: priv,
              grantable,
            }));
            changes.push(
              new GrantTablePrivileges({
                table: branchTable,
                grantee,
                privileges,
                columns: group.columns,
                version: ctx.version,
              }),
            );
          }
        }
      }

      // Generate revoke changes
      if (result.revokes.length > 0) {
        const revokeGroups = groupPrivilegesByColumns(result.revokes);
        for (const [, group] of revokeGroups) {
          // Collapse all grantable groups into a single revoke (grantable: false)
          const allPrivileges = new Set<string>();
          for (const [, privSet] of group.byGrant) {
            for (const priv of privSet) {
              allPrivileges.add(priv);
            }
          }
          const privileges = Array.from(allPrivileges).map((priv) => ({
            privilege: priv,
            grantable: false,
          }));
          changes.push(
            new RevokeTablePrivileges({
              table: branchTable,
              grantee,
              privileges,
              columns: group.columns,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke grant option changes
      if (result.revokeGrantOption.length > 0) {
        const revokeGrantGroups = new Map<
          string,
          { columns?: string[]; privileges: Set<string> }
        >();
        for (const r of result.revokeGrantOption) {
          // For revoke grant option, we need to find the columns from the original privilege
          const originalPriv = defaultPrivileges.find(
            (p) => p.grantee === grantee && p.privilege === r,
          );
          const key = originalPriv?.columns
            ? originalPriv.columns.sort().join(",")
            : "";
          if (!revokeGrantGroups.has(key)) {
            revokeGrantGroups.set(key, {
              columns: originalPriv?.columns
                ? [...originalPriv.columns]
                : undefined,
              privileges: new Set(),
            });
          }
          const group = revokeGrantGroups.get(key);
          if (!group) continue;
          group.privileges.add(r);
        }
        for (const [, group] of revokeGrantGroups) {
          const privilegeNames = Array.from(group.privileges);
          changes.push(
            new RevokeGrantOptionTablePrivileges({
              table: branchTable,
              grantee,
              privilegeNames,
              columns: group.columns,
              version: ctx.version,
            }),
          );
        }
      }
    }
  }

  for (const tableId of dropped) {
    changes.push(new DropTable({ table: main[tableId] }));
  }

  for (const tableId of altered) {
    const mainTable = main[tableId];
    const branchTable = branch[tableId];

    // Dangerous operations (drop+create) are not performed by this tool.
    // Only emit safe ALTER statements below.
    // Only alterable properties changed - check each one

    // PERSISTENCE (LOGGED/UNLOGGED)
    if (mainTable.persistence !== branchTable.persistence) {
      if (branchTable.persistence === "u" && mainTable.persistence === "p") {
        changes.push(new AlterTableSetUnlogged({ table: mainTable }));
      } else if (
        branchTable.persistence === "p" &&
        mainTable.persistence === "u"
      ) {
        changes.push(new AlterTableSetLogged({ table: mainTable }));
      }
    }

    // ROW LEVEL SECURITY
    if (mainTable.row_security !== branchTable.row_security) {
      if (branchTable.row_security) {
        changes.push(
          new AlterTableEnableRowLevelSecurity({ table: mainTable }),
        );
      } else {
        changes.push(
          new AlterTableDisableRowLevelSecurity({ table: mainTable }),
        );
      }
    }

    // FORCE ROW LEVEL SECURITY
    if (mainTable.force_row_security !== branchTable.force_row_security) {
      if (branchTable.force_row_security) {
        changes.push(new AlterTableForceRowLevelSecurity({ table: mainTable }));
      } else {
        changes.push(
          new AlterTableNoForceRowLevelSecurity({ table: mainTable }),
        );
      }
    }

    // STORAGE PARAMS (WITH (...))
    if (!deepEqual(mainTable.options, branchTable.options)) {
      const mainOpts = mainTable.options ?? [];
      const branchOpts = branchTable.options ?? [];

      // Always set branch options when provided
      if (branchOpts.length > 0) {
        changes.push(
          new AlterTableSetStorageParams({
            table: mainTable,
            options: branchOpts,
          }),
        );
      }

      // Reset any params that are present in main but absent in branch
      if (mainOpts.length > 0) {
        const mainNames = new Set(mainOpts.map((opt) => opt.split("=")[0]));
        const branchNames = new Set(branchOpts.map((opt) => opt.split("=")[0]));
        const removed: string[] = [];
        for (const name of mainNames) {
          if (!branchNames.has(name)) removed.push(name);
        }
        if (removed.length > 0) {
          changes.push(
            new AlterTableResetStorageParams({
              table: mainTable,
              params: removed,
            }),
          );
        }
      }
    }

    // REPLICA IDENTITY
    if (mainTable.replica_identity !== branchTable.replica_identity) {
      // Skip when target is 'i' (USING INDEX) — handled by index changes
      if (branchTable.replica_identity !== "i") {
        changes.push(
          new AlterTableSetReplicaIdentity({
            table: mainTable,
            mode: branchTable.replica_identity,
          }),
        );
      }
    }

    // OWNER
    if (mainTable.owner !== branchTable.owner) {
      changes.push(
        new AlterTableChangeOwner({
          table: mainTable,
          owner: branchTable.owner,
        }),
      );
    }

    // TABLE COMMENT (create/drop when comment changes)
    if (mainTable.comment !== branchTable.comment) {
      if (branchTable.comment === null) {
        changes.push(new DropCommentOnTable({ table: mainTable }));
      } else {
        changes.push(new CreateCommentOnTable({ table: branchTable }));
      }
    }

    // PARTITION ATTACH/DETACH
    const mainIsPartition = Boolean(
      mainTable.parent_schema && mainTable.parent_name,
    );
    const branchIsPartition = Boolean(
      branchTable.parent_schema && branchTable.parent_name,
    );

    // Helper to resolve parent table from catalogs
    const resolveParent = (
      catalog: Record<string, Table>,
      schema: string,
      name: string,
    ): Table | undefined => catalog[`table:${schema}.${name}`];

    if (!mainIsPartition && branchIsPartition) {
      const table = resolveParent(
        branch,
        branchTable.parent_schema as string,
        branchTable.parent_name as string,
      );
      if (table) {
        changes.push(
          new AlterTableAttachPartition({ table, partition: branchTable }),
        );
      }
    } else if (mainIsPartition && !branchIsPartition) {
      const table = resolveParent(
        main,
        mainTable.parent_schema as string,
        mainTable.parent_name as string,
      );
      if (table) {
        changes.push(
          new AlterTableDetachPartition({ table, partition: mainTable }),
        );
      }
    } else if (mainIsPartition && branchIsPartition) {
      const parentChanged =
        mainTable.parent_schema !== branchTable.parent_schema ||
        mainTable.parent_name !== branchTable.parent_name;
      const boundChanged =
        mainTable.partition_bound !== branchTable.partition_bound;
      if (parentChanged || boundChanged) {
        const oldParent = resolveParent(
          main,
          mainTable.parent_schema as string,
          mainTable.parent_name as string,
        );
        if (oldParent) {
          changes.push(
            new AlterTableDetachPartition({
              table: oldParent,
              partition: mainTable,
            }),
          );
        }
        const newParent = resolveParent(
          branch,
          branchTable.parent_schema as string,
          branchTable.parent_name as string,
        );
        if (newParent) {
          changes.push(
            new AlterTableAttachPartition({
              table: newParent,
              partition: branchTable,
            }),
          );
        }
      }
    }

    changes.push(
      ...createAlterConstraintChange(mainTable, branchTable, branch),
    );

    // COLUMNS
    const mainCols = new Map(mainTable.columns.map((c) => [c.name, c]));
    const branchCols = new Map(branchTable.columns.map((c) => [c.name, c]));

    // Added columns
    for (const [name, col] of branchCols) {
      if (!mainCols.has(name)) {
        changes.push(
          new AlterTableAddColumn({ table: branchTable, column: col }),
        );
        if (col.comment !== null && col.comment !== undefined) {
          changes.push(
            new CreateCommentOnColumn({ table: branchTable, column: col }),
          );
        }
      }
    }

    // Dropped columns
    for (const [name, col] of mainCols) {
      if (!branchCols.has(name)) {
        changes.push(
          new AlterTableDropColumn({ table: mainTable, column: col }),
        );
      }
    }

    // Altered columns
    for (const [name, mainCol] of mainCols) {
      const branchCol = branchCols.get(name);
      if (!branchCol) continue;

      // TYPE or COLLATION change
      if (
        mainCol.data_type_str !== branchCol.data_type_str ||
        mainCol.collation !== branchCol.collation
      ) {
        changes.push(
          new AlterTableAlterColumnType({
            table: branchTable,
            column: branchCol,
          }),
        );
      }

      // DEFAULT change
      if (mainCol.default !== branchCol.default) {
        if (branchCol.default === null) {
          // Drop default value
          changes.push(
            new AlterTableAlterColumnDropDefault({
              table: branchTable,
              column: branchCol,
            }),
          );
        } else {
          // Set new default value
          const isGeneratedColumn = branchCol.is_generated;
          const isPostgresLowerThan17 = ctx.version < 170000;

          if (isGeneratedColumn && isPostgresLowerThan17) {
            // For generated columns in < PostgreSQL 17, we need to drop and recreate
            // instead of using SET EXPRESSION AS for computed columns
            // cf: https://git.postgresql.org/gitweb/?p=postgresql.git;a=commitdiff;h=5d06e99a3
            // cf: https://www.postgresql.org/docs/release/17.0/
            // > Allow ALTER TABLE to change a column's generation expression
            changes.push(
              new AlterTableDropColumn({
                table: mainTable,
                column: mainCol,
              }),
            );
            changes.push(
              new AlterTableAddColumn({
                table: branchTable,
                column: branchCol,
              }),
            );
          } else {
            // Use standard SET DEFAULT or SET EXPRESSION AS for newer PostgreSQL versions
            changes.push(
              new AlterTableAlterColumnSetDefault({
                table: branchTable,
                column: branchCol,
              }),
            );
          }
        }
      }

      // NOT NULL change
      if (mainCol.not_null !== branchCol.not_null) {
        if (branchCol.not_null) {
          changes.push(
            new AlterTableAlterColumnSetNotNull({
              table: branchTable,
              column: branchCol,
            }),
          );
        } else {
          changes.push(
            new AlterTableAlterColumnDropNotNull({
              table: branchTable,
              column: branchCol,
            }),
          );
        }
      }

      // COMMENT change on column
      if (mainCol.comment !== branchCol.comment) {
        if (branchCol.comment === null) {
          changes.push(
            new DropCommentOnColumn({ table: mainTable, column: mainCol }),
          );
        } else {
          changes.push(
            new CreateCommentOnColumn({
              table: branchTable,
              column: branchCol,
            }),
          );
        }
      }
    }

    // PRIVILEGES (unified object and column privileges)
    const privilegeResults = diffPrivileges(
      mainTable.privileges,
      branchTable.privileges,
    );

    for (const [grantee, result] of privilegeResults) {
      // Generate grant changes
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByColumns(result.grants);
        for (const [, group] of grantGroups) {
          for (const [grantable, privSet] of group.byGrant) {
            const privileges = Array.from(privSet).map((priv) => ({
              privilege: priv,
              grantable,
            }));
            changes.push(
              new GrantTablePrivileges({
                table: branchTable,
                grantee,
                privileges,
                columns: group.columns,
                version: ctx.version,
              }),
            );
          }
        }
      }

      // Generate revoke changes
      if (result.revokes.length > 0) {
        const revokeGroups = groupPrivilegesByColumns(result.revokes);
        for (const [, group] of revokeGroups) {
          // Collapse all grantable groups into a single revoke (grantable: false)
          const allPrivileges = new Set<string>();
          for (const [, privSet] of group.byGrant) {
            for (const priv of privSet) {
              allPrivileges.add(priv);
            }
          }
          const privileges = Array.from(allPrivileges).map((priv) => ({
            privilege: priv,
            grantable: false,
          }));
          changes.push(
            new RevokeTablePrivileges({
              table: mainTable,
              grantee,
              privileges,
              columns: group.columns,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke grant option changes
      if (result.revokeGrantOption.length > 0) {
        const revokeGrantGroups = new Map<
          string,
          { columns?: string[]; privileges: Set<string> }
        >();
        for (const r of result.revokeGrantOption) {
          // For revoke grant option, we need to find the columns from the original privilege
          const originalPriv = mainTable.privileges.find(
            (p) => p.grantee === grantee && p.privilege === r,
          );
          const key = originalPriv?.columns
            ? originalPriv.columns.sort().join(",")
            : "";
          if (!revokeGrantGroups.has(key)) {
            revokeGrantGroups.set(key, {
              columns: originalPriv?.columns
                ? [...originalPriv.columns]
                : undefined,
              privileges: new Set(),
            });
          }
          const group = revokeGrantGroups.get(key);
          if (!group) continue;
          group.privileges.add(r);
        }
        for (const [, group] of revokeGrantGroups) {
          const privilegeNames = Array.from(group.privileges);
          changes.push(
            new RevokeGrantOptionTablePrivileges({
              table: mainTable,
              grantee,
              privilegeNames,
              columns: group.columns,
              version: ctx.version,
            }),
          );
        }
      }
    }
  }

  return changes;
}
