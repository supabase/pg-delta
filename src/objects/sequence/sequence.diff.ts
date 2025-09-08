import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { hasNonAlterableChanges } from "../utils.ts";
import {
  AlterSequenceSetOptions,
  AlterSequenceSetOwnedBy,
  ReplaceSequence,
} from "./changes/sequence.alter.ts";
import { CreateSequence } from "./changes/sequence.create.ts";
import { DropSequence } from "./changes/sequence.drop.ts";
import type { Sequence } from "./sequence.model.ts";

/**
 * Diff two sets of sequences from main and branch catalogs.
 *
 * @param main - The sequences in the main catalog.
 * @param branch - The sequences in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffSequences(
  main: Record<string, Sequence>,
  branch: Record<string, Sequence>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const sequenceId of created) {
    const createdSeq = branch[sequenceId];
    changes.push(new CreateSequence({ sequence: createdSeq }));
    // If the created sequence is OWNED BY a column, emit an ALTER to set it
    if (
      createdSeq.owned_by_schema !== null &&
      createdSeq.owned_by_table !== null &&
      createdSeq.owned_by_column !== null
    ) {
      changes.push(
        new AlterSequenceSetOwnedBy({ main: createdSeq, branch: createdSeq }),
      );
    }
  }

  for (const sequenceId of dropped) {
    changes.push(new DropSequence({ sequence: main[sequenceId] }));
  }

  for (const sequenceId of altered) {
    const mainSequence = main[sequenceId];
    const branchSequence = branch[sequenceId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the sequence
    const NON_ALTERABLE_FIELDS: Array<keyof Sequence> = [
      "data_type",
      "persistence",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainSequence,
      branchSequence,
      NON_ALTERABLE_FIELDS,
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire sequence (drop + create)
      changes.push(
        new ReplaceSequence({ main: mainSequence, branch: branchSequence }),
      );
      // Re-apply OWNED BY if present on branch
      if (
        branchSequence.owned_by_schema !== null &&
        branchSequence.owned_by_table !== null &&
        branchSequence.owned_by_column !== null
      ) {
        changes.push(
          new AlterSequenceSetOwnedBy({
            main: branchSequence,
            branch: branchSequence,
          }),
        );
      } else if (
        mainSequence.owned_by_schema !== null ||
        mainSequence.owned_by_table !== null ||
        mainSequence.owned_by_column !== null
      ) {
        // If main had ownership but branch removed it, emit OWNED BY NONE
        changes.push(
          new AlterSequenceSetOwnedBy({
            main: mainSequence,
            branch: branchSequence,
          }),
        );
      }
    } else {
      // Only alterable properties changed - emit ALTER for options/owner
      const optionsChanged =
        mainSequence.increment !== branchSequence.increment ||
        mainSequence.minimum_value !== branchSequence.minimum_value ||
        mainSequence.maximum_value !== branchSequence.maximum_value ||
        mainSequence.start_value !== branchSequence.start_value ||
        mainSequence.cache_size !== branchSequence.cache_size ||
        mainSequence.cycle_option !== branchSequence.cycle_option;

      if (optionsChanged) {
        const alterOptions = new AlterSequenceSetOptions({
          main: mainSequence,
          branch: branchSequence,
        });
        changes.push(alterOptions);
      }

      const ownedByChanged =
        mainSequence.owned_by_schema !== branchSequence.owned_by_schema ||
        mainSequence.owned_by_table !== branchSequence.owned_by_table ||
        mainSequence.owned_by_column !== branchSequence.owned_by_column;

      if (ownedByChanged) {
        changes.push(
          new AlterSequenceSetOwnedBy({
            main: mainSequence,
            branch: branchSequence,
          }),
        );
      }

      // Note: Sequence renaming would also use ALTER SEQUENCE ... RENAME TO ...
      // But since our Sequence model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
