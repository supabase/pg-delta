import { diffObjects } from "../base.diff.ts";
import { hasNonAlterableChanges } from "../utils.ts";
import {
  AlterCollationChangeOwner,
  AlterCollationRefreshVersion,
} from "./changes/collation.alter.ts";
import {
  CreateCommentOnCollation,
  DropCommentOnCollation,
} from "./changes/collation.comment.ts";
import { CreateCollation } from "./changes/collation.create.ts";
import { DropCollation } from "./changes/collation.drop.ts";
import type { CollationChange } from "./changes/collation.types.ts";
import type { Collation } from "./collation.model.ts";

/**
 * Diff two sets of collations from main and branch catalogs.
 *
 * @param ctx - Context containing currentUser
 * @param main - The collations in the main catalog.
 * @param branch - The collations in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffCollations(
  ctx: { currentUser: string },
  main: Record<string, Collation>,
  branch: Record<string, Collation>,
): CollationChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: CollationChange[] = [];

  for (const collationId of created) {
    const coll = branch[collationId];
    changes.push(new CreateCollation({ collation: coll }));

    // OWNER: If the collation should be owned by someone other than the current user,
    // emit ALTER COLLATION ... OWNER TO after creation
    if (coll.owner !== ctx.currentUser) {
      changes.push(
        new AlterCollationChangeOwner({
          collation: coll,
          owner: coll.owner,
        }),
      );
    }

    if (coll.comment !== null) {
      changes.push(new CreateCommentOnCollation({ collation: coll }));
    }
  }

  for (const collationId of dropped) {
    changes.push(new DropCollation({ collation: main[collationId] }));
  }

  for (const collationId of altered) {
    const mainCollation = main[collationId];
    const branchCollation = branch[collationId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the collation
    const NON_ALTERABLE_FIELDS: Array<keyof Collation> = [
      "provider",
      "is_deterministic",
      "encoding",
      "collate",
      "ctype",
      "locale",
      "icu_rules",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainCollation,
      branchCollation,
      NON_ALTERABLE_FIELDS,
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire collation (drop + create)
      changes.push(
        new DropCollation({ collation: mainCollation }),
        new CreateCollation({ collation: branchCollation }),
      );
    } else {
      // Only alterable properties changed - check each one

      // VERSION
      if (mainCollation.version !== branchCollation.version) {
        changes.push(
          new AlterCollationRefreshVersion({
            collation: mainCollation,
          }),
        );
      }

      // OWNER
      if (mainCollation.owner !== branchCollation.owner) {
        changes.push(
          new AlterCollationChangeOwner({
            collation: mainCollation,
            owner: branchCollation.owner,
          }),
        );
      }

      // COMMENT
      if (mainCollation.comment !== branchCollation.comment) {
        if (branchCollation.comment === null) {
          changes.push(
            new DropCommentOnCollation({ collation: mainCollation }),
          );
        } else {
          changes.push(
            new CreateCommentOnCollation({ collation: branchCollation }),
          );
        }
      }

      // Note: Collation renaming would also use ALTER COLLATION ... RENAME TO ...
      // But since our Collation model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
