import type { Change } from "../../base.change.ts";
import { diffObjects } from "../../base.diff.ts";
import { hasNonAlterableChanges } from "../../utils.ts";
import { AlterRangeChangeOwner, ReplaceRange } from "./changes/range.alter.ts";
import { CreateRange } from "./changes/range.create.ts";
import { DropRange } from "./changes/range.drop.ts";
import type { Range } from "./range.model.ts";

/**
 * Diff two sets of range types from main and branch catalogs.
 *
 * @param main - The ranges in the main catalog.
 * @param branch - The ranges in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffRanges(
  main: Record<string, Range>,
  branch: Record<string, Range>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const id of created) {
    changes.push(new CreateRange({ range: branch[id] }));
  }

  for (const id of dropped) {
    changes.push(new DropRange({ range: main[id] }));
  }

  for (const id of altered) {
    const mainRange = main[id];
    const branchRange = branch[id];

    const NON_ALTERABLE_FIELDS: Array<keyof Range> = [
      // Changes to these require DROP + CREATE
      "subtype_schema",
      "subtype_str",
      "collation",
      "canonical_function_schema",
      "canonical_function_name",
      "subtype_diff_schema",
      "subtype_diff_name",
      "subtype_opclass_schema",
      "subtype_opclass_name",
    ];

    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainRange,
      branchRange,
      NON_ALTERABLE_FIELDS,
    );

    if (nonAlterablePropsChanged) {
      changes.push(new ReplaceRange({ main: mainRange, branch: branchRange }));
    } else {
      if (mainRange.owner !== branchRange.owner) {
        changes.push(
          new AlterRangeChangeOwner({ main: mainRange, branch: branchRange }),
        );
      }
    }
  }

  return changes;
}
