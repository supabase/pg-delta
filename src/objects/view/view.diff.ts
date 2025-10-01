import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterViewChangeOwner,
  AlterViewResetOptions,
  AlterViewSetOptions,
} from "./changes/view.alter.ts";
import {
  CreateCommentOnView,
  DropCommentOnView,
} from "./changes/view.comment.ts";
import { CreateView } from "./changes/view.create.ts";
import { DropView } from "./changes/view.drop.ts";
import type { View } from "./view.model.ts";

/**
 * Diff two sets of views from main and branch catalogs.
 *
 * @param main - The views in the main catalog.
 * @param branch - The views in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffViews(
  main: Record<string, View>,
  branch: Record<string, View>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const viewId of created) {
    const v = branch[viewId];
    changes.push(new CreateView({ view: v }));
    if (v.comment !== null) {
      changes.push(new CreateCommentOnView({ view: v }));
    }
  }

  for (const viewId of dropped) {
    changes.push(new DropView({ view: main[viewId] }));
  }

  for (const viewId of altered) {
    const mainView = main[viewId];
    const branchView = branch[viewId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the view
    const NON_ALTERABLE_FIELDS: Array<keyof View> = [
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
      mainView,
      branchView,
      NON_ALTERABLE_FIELDS,
      { options: deepEqual },
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire view using CREATE OR REPLACE to avoid drop when possible
      changes.push(new CreateView({ view: branchView, orReplace: true }));
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainView.owner !== branchView.owner) {
        changes.push(
          new AlterViewChangeOwner({
            main: mainView,
            branch: branchView,
          }),
        );
      }

      // VIEW OPTIONS (WITH (...))
      if (!deepEqual(mainView.options, branchView.options)) {
        const mainOpts = mainView.options ?? [];
        const branchOpts = branchView.options ?? [];

        // Always set branch options when provided
        if (branchOpts.length > 0) {
          changes.push(
            new AlterViewSetOptions({ main: mainView, branch: branchView }),
          );
        }

        // Reset any params that are present in main but absent in branch
        if (mainOpts.length > 0) {
          const mainNames = new Set(mainOpts.map((opt) => opt.split("=")[0]));
          const branchNames = new Set(
            branchOpts.map((opt) => opt.split("=")[0]),
          );
          const removed: string[] = [];
          for (const name of mainNames) {
            if (!branchNames.has(name)) removed.push(name);
          }
          if (removed.length > 0) {
            changes.push(
              new AlterViewResetOptions({ view: mainView, params: removed }),
            );
          }
        }
      }

      // COMMENT
      if (mainView.comment !== branchView.comment) {
        if (branchView.comment === null) {
          changes.push(new DropCommentOnView({ view: mainView }));
        } else {
          changes.push(new CreateCommentOnView({ view: branchView }));
        }
      }

      // Note: View renaming would also use ALTER VIEW ... RENAME TO ...
      // But since our View model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
