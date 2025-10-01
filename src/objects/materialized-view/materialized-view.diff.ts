import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterMaterializedViewChangeOwner,
  AlterMaterializedViewSetStorageParams,
} from "./changes/materialized-view.alter.ts";
import {
  CreateCommentOnMaterializedView,
  CreateCommentOnMaterializedViewColumn,
  DropCommentOnMaterializedView,
  DropCommentOnMaterializedViewColumn,
} from "./changes/materialized-view.comment.ts";
import { CreateMaterializedView } from "./changes/materialized-view.create.ts";
import { DropMaterializedView } from "./changes/materialized-view.drop.ts";
import type { MaterializedView } from "./materialized-view.model.ts";

/**
 * Diff two sets of materialized views from main and branch catalogs.
 *
 * @param main - The materialized views in the main catalog.
 * @param branch - The materialized views in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffMaterializedViews(
  main: Record<string, MaterializedView>,
  branch: Record<string, MaterializedView>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const materializedViewId of created) {
    changes.push(
      new CreateMaterializedView({
        materializedView: branch[materializedViewId],
      }),
    );
    // Materialized view comment on creation
    if (branch[materializedViewId].comment !== null) {
      changes.push(
        new CreateCommentOnMaterializedView({
          materializedView: branch[materializedViewId],
        }),
      );
    }
    // Column comments on creation
    for (const col of branch[materializedViewId].columns) {
      if (col.comment !== null) {
        changes.push(
          new CreateCommentOnMaterializedViewColumn({
            materializedView: branch[materializedViewId],
            column: col,
          }),
        );
      }
    }
  }

  for (const materializedViewId of dropped) {
    changes.push(
      new DropMaterializedView({ materializedView: main[materializedViewId] }),
    );
  }

  for (const materializedViewId of altered) {
    const mainMaterializedView = main[materializedViewId];
    const branchMaterializedView = branch[materializedViewId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the materialized view
    const NON_ALTERABLE_FIELDS: Array<keyof MaterializedView> = [
      "definition",
      "row_security",
      "force_row_security",
      "has_indexes",
      "has_rules",
      "has_triggers",
      "has_subclasses",
      "is_populated",
      "replica_identity",
      "is_partition",
      "partition_bound",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainMaterializedView,
      branchMaterializedView,
      NON_ALTERABLE_FIELDS,
      { options: deepEqual },
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire materialized view (drop + create)
      changes.push(
        new DropMaterializedView({ materializedView: mainMaterializedView }),
        new CreateMaterializedView({
          materializedView: branchMaterializedView,
        }),
      );
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainMaterializedView.owner !== branchMaterializedView.owner) {
        changes.push(
          new AlterMaterializedViewChangeOwner({
            main: mainMaterializedView,
            branch: branchMaterializedView,
          }),
        );
      }

      // STORAGE PARAMETERS (reloptions)
      // Emit a combined SET/RESET change similar to indexes
      if (
        !deepEqual(mainMaterializedView.options, branchMaterializedView.options)
      ) {
        changes.push(
          new AlterMaterializedViewSetStorageParams({
            main: mainMaterializedView,
            branch: branchMaterializedView,
          }),
        );
      }

      // Note: Materialized view renaming would also use ALTER MATERIALIZED VIEW ... RENAME TO ...
      // But since our MaterializedView model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
      // MATERIALIZED VIEW COMMENT (create/drop when comment changes)
      if (mainMaterializedView.comment !== branchMaterializedView.comment) {
        if (branchMaterializedView.comment === null) {
          changes.push(
            new DropCommentOnMaterializedView({
              materializedView: mainMaterializedView,
            }),
          );
        } else {
          changes.push(
            new CreateCommentOnMaterializedView({
              materializedView: branchMaterializedView,
            }),
          );
        }
      }
      // COMMENT changes on columns
      const mainCols = new Map(
        mainMaterializedView.columns.map((c) => [c.name, c]),
      );
      const branchCols = new Map(
        branchMaterializedView.columns.map((c) => [c.name, c]),
      );
      for (const [name, branchCol] of branchCols) {
        const mainCol = mainCols.get(name);
        if (!mainCol) continue;
        if (mainCol.comment !== branchCol.comment) {
          if (branchCol.comment === null) {
            changes.push(
              new DropCommentOnMaterializedViewColumn({
                materializedView: mainMaterializedView,
                column: mainCol,
              }),
            );
          } else {
            changes.push(
              new CreateCommentOnMaterializedViewColumn({
                materializedView: branchMaterializedView,
                column: branchCol,
              }),
            );
          }
        }
      }
    }
  }

  return changes;
}
