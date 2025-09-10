import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { deepEqual } from "../utils.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropNotNull,
  AlterTableAlterColumnSetDefault,
  AlterTableAlterColumnSetNotNull,
  AlterTableAlterColumnType,
  AlterTableChangeOwner,
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
import { CreateTable } from "./changes/table.create.ts";
import { DropTable } from "./changes/table.drop.ts";
import { Table } from "./table.model.js";

function createAlterConstraintChange(
  mainTable: Table,
  branchTable: Table,
  branchCatalog: Record<string, Table>,
) {
  const changes: Change[] = [];

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
    const branchForeignKeyTable =
      c.constraint_type === "f"
        ? branchCatalog[`table:${c.foreign_key_schema}.${c.foreign_key_table}`]
        : undefined;

    if (!mainByName.has(name)) {
      changes.push(
        new AlterTableAddConstraint({
          table: branchTable,
          constraint: c,
          foreignKeyTable: branchForeignKeyTable,
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
    }
  }

  // Dropped constraints
  for (const [name, c] of mainByName) {
    if (!branchByName.has(name)) {
      changes.push(
        new AlterTableDropConstraint({ table: mainTable, constraint: c }),
      );
    }
  }

  // Altered constraints -> drop + add
  for (const [name, mainC] of mainByName) {
    const branchC = branchByName.get(name);
    const branchForeignKeyTable =
      branchC?.constraint_type === "f"
        ? branchCatalog[
            `table:${branchC.foreign_key_schema}.${branchC.foreign_key_table}`
          ]
        : undefined;
    if (!branchC) continue;
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
      mainC.check_expression !== branchC.check_expression ||
      mainC.owner !== branchC.owner;
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
          foreignKeyTable: branchForeignKeyTable,
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
    }
  }

  return changes;
}

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
      const mainOpts = mainTable.options ?? [];
      const branchOpts = branchTable.options ?? [];

      // Always set branch options when provided
      if (branchOpts.length > 0) {
        changes.push(
          new AlterTableSetStorageParams({
            main: mainTable,
            branch: branchTable,
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
          changes.push(
            new AlterTableAlterColumnDropDefault({
              table: branchTable,
              column: branchCol,
            }),
          );
        } else {
          changes.push(
            new AlterTableAlterColumnSetDefault({
              table: branchTable,
              column: branchCol,
            }),
          );
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
    }
  }

  return changes;
}
