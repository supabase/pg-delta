import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterTableChangeOwner,
  AlterTableDisableRowLevelSecurity,
  AlterTableEnableRowLevelSecurity,
  AlterTableForceRowLevelSecurity,
  AlterTableNoForceRowLevelSecurity,
  AlterTableSetLogged,
  AlterTableSetStorageParams,
  AlterTableSetUnlogged,
  ReplaceTable,
} from "./changes/table.alter.ts";
import { CreateTable } from "./changes/table.create.ts";
import { DropTable } from "./changes/table.drop.ts";
import type { Table } from "./table.model.ts";

/**
 * Diff two sets of tables from main and branch catalogs.
 *
 * @param main - The tables in the main catalog.
 * @param branch - The tables in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffTables(
  main: Record<string, Table>,
  branch: Record<string, Table>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const tableId of created) {
    changes.push(new CreateTable({ table: branch[tableId] }));
  }

  for (const tableId of dropped) {
    changes.push(new DropTable({ table: main[tableId] }));
  }

  for (const tableId of altered) {
    const mainTable = main[tableId];
    const branchTable = branch[tableId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the table
    const NON_ALTERABLE_FIELDS: Array<keyof Table> = [
      "has_indexes",
      "has_rules",
      "has_triggers",
      "has_subclasses",
      "is_populated",
      "replica_identity",
      "is_partition",
      "partition_bound",
      "parent_schema",
      "parent_name",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainTable,
      branchTable,
      NON_ALTERABLE_FIELDS,
      { options: deepEqual },
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire table (drop + create)
      changes.push(new ReplaceTable({ main: mainTable, branch: branchTable }));
    } else {
      // Only alterable properties changed - check each one

      // PERSISTENCE (LOGGED/UNLOGGED)
      if (mainTable.persistence !== branchTable.persistence) {
        const involvesTemporary =
          mainTable.persistence === "t" || branchTable.persistence === "t";
        if (involvesTemporary) {
          changes.push(
            new ReplaceTable({ main: mainTable, branch: branchTable }),
          );
        } else if (
          branchTable.persistence === "u" &&
          mainTable.persistence === "p"
        ) {
          changes.push(
            new AlterTableSetUnlogged({ main: mainTable, branch: branchTable }),
          );
        } else if (
          branchTable.persistence === "p" &&
          mainTable.persistence === "u"
        ) {
          changes.push(
            new AlterTableSetLogged({ main: mainTable, branch: branchTable }),
          );
        }
      }

      // ROW LEVEL SECURITY
      if (mainTable.row_security !== branchTable.row_security) {
        if (branchTable.row_security) {
          changes.push(
            new AlterTableEnableRowLevelSecurity({
              main: mainTable,
              branch: branchTable,
            }),
          );
        } else {
          changes.push(
            new AlterTableDisableRowLevelSecurity({
              main: mainTable,
              branch: branchTable,
            }),
          );
        }
      }

      // FORCE ROW LEVEL SECURITY
      if (mainTable.force_row_security !== branchTable.force_row_security) {
        if (branchTable.force_row_security) {
          changes.push(
            new AlterTableForceRowLevelSecurity({
              main: mainTable,
              branch: branchTable,
            }),
          );
        } else {
          changes.push(
            new AlterTableNoForceRowLevelSecurity({
              main: mainTable,
              branch: branchTable,
            }),
          );
        }
      }

      // STORAGE PARAMS (WITH (...))
      if (!deepEqual(mainTable.options, branchTable.options)) {
        if (branchTable.options && branchTable.options.length > 0) {
          changes.push(
            new AlterTableSetStorageParams({
              main: mainTable,
              branch: branchTable,
            }),
          );
        }
      }

      // OWNER
      if (mainTable.owner !== branchTable.owner) {
        changes.push(
          new AlterTableChangeOwner({
            main: mainTable,
            branch: branchTable,
          }),
        );
      }

      // Note: Table renaming would also use ALTER TABLE ... RENAME TO ...
      // But since our Table model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
