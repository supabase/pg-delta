import { diffObjects } from "../base.diff.ts";
import type { TableLikeObject } from "../base.model.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterIndexSetStatistics,
  AlterIndexSetStorageParams,
  AlterIndexSetTablespace,
} from "./changes/index.alter.ts";
import {
  CreateCommentOnIndex,
  DropCommentOnIndex,
} from "./changes/index.comment.ts";
import { CreateIndex } from "./changes/index.create.ts";
import { DropIndex } from "./changes/index.drop.ts";
import type { IndexChange } from "./changes/index.types.ts";
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
): IndexChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: IndexChange[] = [];

  for (const indexId of created) {
    const index = branch[indexId];
    // Skip indexes owned by constraints - they are automatically created by AlterTableAddConstraint
    if (!index.is_owned_by_constraint) {
      changes.push(
        new CreateIndex({
          index,
          indexableObject: branchIndexableObjects[index.tableStableId],
        }),
      );
      if (index.comment !== null) {
        changes.push(new CreateCommentOnIndex({ index }));
      }
    }
  }

  for (const indexId of dropped) {
    const index = main[indexId];
    // if the index is owned by a constraint it'll be handled by an ALTER TABLE DROP CONSTRAINT
    // or if the entire table the index refers to has been dropped it'll be handled by a DROP TABLE
    if (
      index.is_owned_by_constraint ||
      !branchIndexableObjects[index.tableStableId]
    ) {
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
        new DropIndex({ index: mainIndex }),
        new CreateIndex({
          index: branchIndex,
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
        const parseOptions = (options: string[]) => {
          const map = new Map<string, string>();
          for (const opt of options) {
            const eqIndex = opt.indexOf("=");
            const key = opt.slice(0, eqIndex);
            const value = opt.slice(eqIndex + 1);
            map.set(key, value);
          }
          return map;
        };

        const mainMap = parseOptions(mainIndex.storage_params);
        const branchMap = parseOptions(branchIndex.storage_params);

        const keysToReset: string[] = [];
        for (const key of mainMap.keys()) {
          if (!branchMap.has(key)) {
            keysToReset.push(key);
          }
        }

        const paramsToSet: string[] = [];
        for (const [key, newValue] of branchMap.entries()) {
          const oldValue = mainMap.get(key);
          const changed = oldValue !== newValue;
          if (changed) {
            paramsToSet.push(`${key}=${newValue}`);
          }
        }

        changes.push(
          new AlterIndexSetStorageParams({
            index: mainIndex,
            paramsToSet,
            keysToReset,
          }),
        );
      }

      // STATISTICS TARGET
      if (
        JSON.stringify(mainIndex.statistics_target) !==
        JSON.stringify(branchIndex.statistics_target)
      ) {
        const columnTargets: Array<{
          columnNumber: number;
          statistics: number;
        }> = [];
        const mainTargets = mainIndex.statistics_target;
        const branchTargets = branchIndex.statistics_target;
        const length = Math.max(mainTargets.length, branchTargets.length);
        for (let i = 0; i < length; i++) {
          const oldVal = mainTargets[i];
          const newVal = branchTargets[i];
          if (oldVal !== newVal && newVal !== undefined) {
            columnTargets.push({ columnNumber: i + 1, statistics: newVal });
          }
        }
        if (columnTargets.length > 0) {
          changes.push(
            new AlterIndexSetStatistics({ index: mainIndex, columnTargets }),
          );
        }
      }

      // TABLESPACE
      if (mainIndex.tablespace !== branchIndex.tablespace) {
        const nextTablespace = branchIndex.tablespace;
        if (nextTablespace !== null) {
          changes.push(
            new AlterIndexSetTablespace({
              index: mainIndex,
              tablespace: nextTablespace,
            }),
          );
        }
      }

      // COMMENT
      if (mainIndex.comment !== branchIndex.comment) {
        if (branchIndex.comment === null) {
          changes.push(new DropCommentOnIndex({ index: mainIndex }));
        } else {
          changes.push(new CreateCommentOnIndex({ index: branchIndex }));
        }
      }

      // Note: Index renaming would also use ALTER INDEX ... RENAME TO ...
      // But since our Index model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
