import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import {
  AlterLanguageChangeOwner,
  ReplaceLanguage,
} from "./changes/language.alter.ts";
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
    changes.push(new CreateLanguage({ language: branch[languageId] }));
  }

  for (const languageId of dropped) {
    changes.push(new DropLanguage({ language: main[languageId] }));
  }

  for (const languageId of altered) {
    const mainLanguage = main[languageId];
    const branchLanguage = branch[languageId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the language
    const nonAlterablePropsChanged =
      mainLanguage.is_trusted !== branchLanguage.is_trusted ||
      mainLanguage.is_procedural !== branchLanguage.is_procedural ||
      mainLanguage.call_handler !== branchLanguage.call_handler ||
      mainLanguage.inline_handler !== branchLanguage.inline_handler ||
      mainLanguage.validator !== branchLanguage.validator;

    if (nonAlterablePropsChanged) {
      // Replace the entire language (drop + create)
      changes.push(
        new ReplaceLanguage({ main: mainLanguage, branch: branchLanguage }),
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

      // Note: Language renaming would also use ALTER LANGUAGE ... RENAME TO ...
      // But since our Language model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
