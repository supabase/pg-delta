import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { hasNonAlterableChanges } from "../utils.ts";
import { AlterLanguageChangeOwner } from "./changes/language.alter.ts";
import {
  CreateCommentOnLanguage,
  DropCommentOnLanguage,
} from "./changes/language.comment.ts";
import { CreateLanguage } from "./changes/language.create.ts";
import { DropLanguage } from "./changes/language.drop.ts";
import type { Language } from "./language.model.ts";

/**
 * Diff two sets of languages from main and branch catalogs.
 *
 * @param main - The languages in the main catalog.
 * @param branch - The languages in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffLanguages(
  main: Record<string, Language>,
  branch: Record<string, Language>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const languageId of created) {
    const lang = branch[languageId];
    changes.push(new CreateLanguage({ language: lang }));
    if (lang.comment !== null) {
      changes.push(new CreateCommentOnLanguage({ language: lang }));
    }
  }

  for (const languageId of dropped) {
    changes.push(new DropLanguage({ language: main[languageId] }));
  }

  for (const languageId of altered) {
    const mainLanguage = main[languageId];
    const branchLanguage = branch[languageId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the language
    const NON_ALTERABLE_FIELDS: Array<keyof Language> = [
      "is_trusted",
      "is_procedural",
      "call_handler",
      "inline_handler",
      "validator",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainLanguage,
      branchLanguage,
      NON_ALTERABLE_FIELDS,
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire language (drop + create)
      changes.push(
        new DropLanguage({ language: mainLanguage }),
        new CreateLanguage({ language: branchLanguage }),
      );
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainLanguage.owner !== branchLanguage.owner) {
        changes.push(
          new AlterLanguageChangeOwner({
            main: mainLanguage,
            branch: branchLanguage,
          }),
        );
      }

      // COMMENT
      if (mainLanguage.comment !== branchLanguage.comment) {
        if (branchLanguage.comment === null) {
          changes.push(new DropCommentOnLanguage({ language: mainLanguage }));
        } else {
          changes.push(
            new CreateCommentOnLanguage({ language: branchLanguage }),
          );
        }
      }

      // Note: Language renaming would also use ALTER LANGUAGE ... RENAME TO ...
      // But since our Language model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
