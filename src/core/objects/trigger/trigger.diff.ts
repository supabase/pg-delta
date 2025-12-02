import { diffObjects } from "../base.diff.ts";
import type { TableLikeObject } from "../base.model.ts";
import { deepEqual, hasNonAlterableChanges, stableId } from "../utils.ts";
import { ReplaceTrigger } from "./changes/trigger.alter.ts";
import {
  CreateCommentOnTrigger,
  DropCommentOnTrigger,
} from "./changes/trigger.comment.ts";
import { CreateTrigger } from "./changes/trigger.create.ts";
import { DropTrigger } from "./changes/trigger.drop.ts";
import type { TriggerChange } from "./changes/trigger.types.ts";
import type { Trigger } from "./trigger.model.ts";

/**
 * Diff two sets of triggers from main and branch catalogs.
 *
 * @param main - The triggers in the main catalog.
 * @param branch - The triggers in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffTriggers(
  main: Record<string, Trigger>,
  branch: Record<string, Trigger>,
  branchIndexableObjects?: Record<string, TableLikeObject>,
): TriggerChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: TriggerChange[] = [];

  for (const triggerId of created) {
    const trigger = branch[triggerId];

    // Skip trigger clones on partitions - they are automatically created when the parent trigger is created
    if (trigger.is_partition_clone) {
      continue;
    }

    const tableStableId = stableId.table(trigger.schema, trigger.table_name);
    changes.push(
      new CreateTrigger({
        trigger: trigger,
        indexableObject: branchIndexableObjects?.[tableStableId],
      }),
    );
    if (trigger.comment !== null) {
      changes.push(new CreateCommentOnTrigger({ trigger: trigger }));
    }
  }

  for (const triggerId of dropped) {
    const trigger = main[triggerId];

    // Skip trigger clones on partitions - they are automatically dropped when the parent trigger is dropped
    if (trigger.is_partition_clone) {
      continue;
    }

    changes.push(new DropTrigger({ trigger }));
  }

  for (const triggerId of altered) {
    const mainTrigger = main[triggerId];
    const branchTrigger = branch[triggerId];

    // Skip trigger clones on partitions - they are automatically updated when the parent trigger is updated
    if (mainTrigger.is_partition_clone || branchTrigger.is_partition_clone) {
      continue;
    }

    const NON_ALTERABLE_FIELDS: Array<keyof Trigger> = [
      "function_schema",
      "function_name",
      "trigger_type",
      "enabled",
      "is_internal",
      "deferrable",
      "initially_deferred",
      "argument_count",
      "column_numbers",
      "arguments",
      "when_condition",
      "old_table",
      "new_table",
      "owner",
    ];
    const shouldReplace = hasNonAlterableChanges(
      mainTrigger,
      branchTrigger,
      NON_ALTERABLE_FIELDS,
      { column_numbers: deepEqual, arguments: deepEqual },
    );
    if (shouldReplace) {
      const tableStableId = stableId.table(
        branchTrigger.schema,
        branchTrigger.table_name,
      );
      changes.push(
        new ReplaceTrigger({
          trigger: branchTrigger,
          indexableObject: branchIndexableObjects?.[tableStableId],
        }),
      );
    } else {
      // COMMENT
      if (mainTrigger.comment !== branchTrigger.comment) {
        if (branchTrigger.comment === null) {
          changes.push(new DropCommentOnTrigger({ trigger: mainTrigger }));
        } else {
          changes.push(new CreateCommentOnTrigger({ trigger: branchTrigger }));
        }
      }
    }
  }

  return changes;
}
