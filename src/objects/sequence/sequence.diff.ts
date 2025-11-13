import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  groupPrivilegesByGrantable,
} from "../base.privilege-diff.ts";
import { hasNonAlterableChanges } from "../utils.ts";
import {
  AlterSequenceSetOptions,
  AlterSequenceSetOwnedBy,
} from "./changes/sequence.alter.ts";
import {
  CreateCommentOnSequence,
  DropCommentOnSequence,
} from "./changes/sequence.comment.ts";
import { CreateSequence } from "./changes/sequence.create.ts";
import { DropSequence } from "./changes/sequence.drop.ts";
import {
  GrantSequencePrivileges,
  RevokeGrantOptionSequencePrivileges,
  RevokeSequencePrivileges,
} from "./changes/sequence.privilege.ts";
import type { SequenceChange } from "./changes/sequence.types.ts";
import type { Sequence } from "./sequence.model.ts";

/**
 * Diff two sets of sequences from main and branch catalogs.
 *
 * @param main - The sequences in the main catalog.
 * @param branch - The sequences in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffSequences(
  ctx: {
    version: number;
    currentUser?: string;
    defaultPrivilegeState?: unknown;
  },
  main: Record<string, Sequence>,
  branch: Record<string, Sequence>,
): SequenceChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: SequenceChange[] = [];

  for (const sequenceId of created) {
    const createdSeq = branch[sequenceId];
    changes.push(new CreateSequence({ sequence: createdSeq }));
    if (createdSeq.comment !== null) {
      changes.push(new CreateCommentOnSequence({ sequence: createdSeq }));
    }
    // If the created sequence is OWNED BY a column, emit an ALTER to set it
    if (
      createdSeq.owned_by_schema !== null &&
      createdSeq.owned_by_table !== null &&
      createdSeq.owned_by_column !== null
    ) {
      changes.push(
        new AlterSequenceSetOwnedBy({
          sequence: createdSeq,
          ownedBy: {
            schema: createdSeq.owned_by_schema,
            table: createdSeq.owned_by_table,
            column: createdSeq.owned_by_column,
          } as { schema: string; table: string; column: string },
        }),
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
        new DropSequence({ sequence: mainSequence }),
        new CreateSequence({ sequence: branchSequence }),
      );
      // Re-apply OWNED BY if present on branch
      if (
        branchSequence.owned_by_schema !== null &&
        branchSequence.owned_by_table !== null &&
        branchSequence.owned_by_column !== null
      ) {
        changes.push(
          new AlterSequenceSetOwnedBy({
            sequence: branchSequence,
            ownedBy: {
              schema: branchSequence.owned_by_schema,
              table: branchSequence.owned_by_table,
              column: branchSequence.owned_by_column,
            } as { schema: string; table: string; column: string },
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
            sequence: mainSequence,
            ownedBy: null,
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
        const options: string[] = [];
        if (mainSequence.increment !== branchSequence.increment) {
          options.push("INCREMENT BY", String(branchSequence.increment));
        }
        if (mainSequence.minimum_value !== branchSequence.minimum_value) {
          const defaultMin = BigInt(1);
          if (branchSequence.minimum_value === defaultMin) {
            options.push("NO MINVALUE");
          } else {
            options.push("MINVALUE", branchSequence.minimum_value.toString());
          }
        }
        if (mainSequence.maximum_value !== branchSequence.maximum_value) {
          const defaultMax =
            branchSequence.data_type === "integer"
              ? BigInt("2147483647")
              : BigInt("9223372036854775807");
          if (branchSequence.maximum_value === defaultMax) {
            options.push("NO MAXVALUE");
          } else {
            options.push("MAXVALUE", branchSequence.maximum_value.toString());
          }
        }
        if (mainSequence.start_value !== branchSequence.start_value) {
          options.push("START WITH", String(branchSequence.start_value));
        }
        if (mainSequence.cache_size !== branchSequence.cache_size) {
          options.push("CACHE", String(branchSequence.cache_size));
        }
        if (mainSequence.cycle_option !== branchSequence.cycle_option) {
          options.push(branchSequence.cycle_option ? "CYCLE" : "NO CYCLE");
        }
        changes.push(
          new AlterSequenceSetOptions({ sequence: mainSequence, options }),
        );
      }

      const ownedByChanged =
        mainSequence.owned_by_schema !== branchSequence.owned_by_schema ||
        mainSequence.owned_by_table !== branchSequence.owned_by_table ||
        mainSequence.owned_by_column !== branchSequence.owned_by_column;

      if (ownedByChanged) {
        const ownedBy =
          branchSequence.owned_by_schema &&
          branchSequence.owned_by_table &&
          branchSequence.owned_by_column
            ? {
                schema: branchSequence.owned_by_schema,
                table: branchSequence.owned_by_table,
                column: branchSequence.owned_by_column,
              }
            : null;
        changes.push(
          new AlterSequenceSetOwnedBy({ sequence: mainSequence, ownedBy }),
        );
      }

      // COMMENT
      if (mainSequence.comment !== branchSequence.comment) {
        if (branchSequence.comment === null) {
          changes.push(new DropCommentOnSequence({ sequence: mainSequence }));
        } else {
          changes.push(
            new CreateCommentOnSequence({ sequence: branchSequence }),
          );
        }
      }

      // PRIVILEGES
      const privilegeResults = diffPrivileges(
        mainSequence.privileges,
        branchSequence.privileges,
      );

      for (const [grantee, result] of privilegeResults) {
        // Generate grant changes
        if (result.grants.length > 0) {
          const grantGroups = groupPrivilegesByGrantable(result.grants);
          for (const [grantable, list] of grantGroups) {
            void grantable;
            changes.push(
              new GrantSequencePrivileges({
                sequence: branchSequence,
                grantee,
                privileges: list,
                version: ctx.version,
              }),
            );
          }
        }

        // Generate revoke changes
        if (result.revokes.length > 0) {
          const revokeGroups = groupPrivilegesByGrantable(result.revokes);
          for (const [grantable, list] of revokeGroups) {
            void grantable;
            changes.push(
              new RevokeSequencePrivileges({
                sequence: mainSequence,
                grantee,
                privileges: list,
                version: ctx.version,
              }),
            );
          }
        }

        // Generate revoke grant option changes
        if (result.revokeGrantOption.length > 0) {
          changes.push(
            new RevokeGrantOptionSequencePrivileges({
              sequence: mainSequence,
              grantee,
              privilegeNames: result.revokeGrantOption,
              version: ctx.version,
            }),
          );
        }
      }

      // Note: Sequence renaming would also use ALTER SEQUENCE ... RENAME TO ...
      // But since our Sequence model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
