import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import type { TableLikeObject } from "../base.model.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterIndexSetStatistics,
  AlterIndexSetStorageParams,
  AlterIndexSetTablespace,
  ReplaceIndex,
} from "./changes/index.alter.ts";
import { CreateIndex } from "./changes/index.create.ts";
import { DropIndex } from "./changes/index.drop.ts";
import type { Index } from "./index.model.ts";

/**
 * Diff two sets of indexes from main and branch catalogs.
 *
 * @param main - The indexes in the main catalog.
 * @param branch - The indexes in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffIndexes(
  main: Record<string, Index>,
  branch: Record<string, Index>,
  branchIndexableObjects: Record<string, TableLikeObject>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const indexId of created) {
    const index = branch[indexId];
    // Skip primary and unique indexes - they are automatically created by AlterTableAddConstraint
    if (!index.is_primary && !index.is_unique) {
      changes.push(
        new CreateIndex({
          index,
          indexableObject: branchIndexableObjects[index.tableStableId],
        }),
      );
    }
  }

  for (const indexId of dropped) {
    const index = main[indexId];
    // if the index is a constraint it'll be handled by an ALTER TABLE
    // or if the entire table the index refers to has been dropped it'll be handled by a DROP TABLE
    if (index.is_constraint || !branchIndexableObjects[index.tableStableId]) {
      continue;
    }
    changes.push(new DropIndex({ index: main[indexId] }));
  }

  for (const indexId of altered) {
    const mainIndex = main[indexId];
    const branchIndex = branch[indexId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the index
    const NON_ALTERABLE_FIELDS: Array<keyof Index> = [
      "index_type",
      "is_unique",
      "is_primary",
      "is_exclusion",
      "nulls_not_distinct",
      "immediate",
      "is_clustered",
      "is_replica_identity",
      "key_columns",
      "column_collations",
      "operator_classes",
      "column_options",
      "index_expressions",
      "partial_predicate",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainIndex,
      branchIndex,
      NON_ALTERABLE_FIELDS,
      {
        key_columns: deepEqual,
        column_collations: deepEqual,
        operator_classes: deepEqual,
        column_options: deepEqual,
      },
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire index (drop + create)
      changes.push(
        new ReplaceIndex({
          main: mainIndex,
          branch: branchIndex,
          indexableObject: branchIndexableObjects[branchIndex.tableStableId],
        }),
      );
    } else {
      // Only alterable properties changed - check each one

      // STORAGE PARAMS
      if (
        JSON.stringify(mainIndex.storage_params) !==
        JSON.stringify(branchIndex.storage_params)
      ) {
        changes.push(
          new AlterIndexSetStorageParams({
            main: mainIndex,
            branch: branchIndex,
          }),
        );
      }

      // STATISTICS TARGET
      if (
        JSON.stringify(mainIndex.statistics_target) !==
        JSON.stringify(branchIndex.statistics_target)
      ) {
        changes.push(
          new AlterIndexSetStatistics({ main: mainIndex, branch: branchIndex }),
        );
      }

      // TABLESPACE
      if (mainIndex.tablespace !== branchIndex.tablespace) {
        changes.push(
          new AlterIndexSetTablespace({ main: mainIndex, branch: branchIndex }),
        );
      }

      // Note: Index renaming would also use ALTER INDEX ... RENAME TO ...
      // But since our Index model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
