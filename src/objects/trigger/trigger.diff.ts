import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import type { TableLikeObject } from "../base.model.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import { ReplaceTrigger } from "./changes/trigger.alter.ts";
import { CreateTrigger } from "./changes/trigger.create.ts";
import { DropTrigger } from "./changes/trigger.drop.ts";
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
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const triggerId of created) {
    const trg = branch[triggerId];
    const tableStableId = `table:${trg.schema}.${trg.table_name}` as const;
    changes.push(
      new CreateTrigger({
        trigger: trg,
        indexableObject: branchIndexableObjects?.[tableStableId],
      }),
    );
  }

  for (const triggerId of dropped) {
    changes.push(new DropTrigger({ trigger: main[triggerId] }));
  }

  for (const triggerId of altered) {
    const mainTrigger = main[triggerId];
    const branchTrigger = branch[triggerId];

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
      const tableStableId =
        `table:${branchTrigger.schema}.${branchTrigger.table_name}` as const;
      changes.push(
        new ReplaceTrigger({
          main: mainTrigger,
          branch: branchTrigger,
          indexableObject: branchIndexableObjects?.[tableStableId],
        }),
      );
    }
  }

  return changes;
}
