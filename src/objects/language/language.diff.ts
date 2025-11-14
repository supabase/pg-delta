import type { Change } from "../../change.types.ts";
import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  filterPublicBuiltInDefaults,
  groupPrivilegesByGrantable,
} from "../base.privilege-diff.ts";
import { hasNonAlterableChanges } from "../utils.ts";
import { AlterLanguageChangeOwner } from "./changes/language.alter.ts";
import {
  CreateCommentOnLanguage,
  DropCommentOnLanguage,
} from "./changes/language.comment.ts";
import { CreateLanguage } from "./changes/language.create.ts";
import { DropLanguage } from "./changes/language.drop.ts";
import {
  GrantLanguagePrivileges,
  RevokeGrantOptionLanguagePrivileges,
  RevokeLanguagePrivileges,
} from "./changes/language.privilege.ts";
import type { Language } from "./language.model.ts";

/**
 * Diff two sets of languages from main and branch catalogs.
 *
 * @param ctx - Context containing version information.
 * @param main - The languages in the main catalog.
 * @param branch - The languages in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffLanguages(
  ctx: { version: number },
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
            language: mainLanguage,
            owner: branchLanguage.owner,
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

      // PRIVILEGES
      // Filter out PUBLIC's built-in default USAGE privilege (PostgreSQL grants it automatically)
      // Reference: https://www.postgresql.org/docs/17/ddl-priv.html Table 5.2
      // This prevents generating unnecessary "GRANT USAGE TO PUBLIC" statements
      const filteredBranchPrivileges = filterPublicBuiltInDefaults(
        "language",
        branchLanguage.privileges,
      );
      const privilegeResults = diffPrivileges(
        mainLanguage.privileges,
        filteredBranchPrivileges,
      );

      for (const [grantee, result] of privilegeResults) {
        // Generate grant changes
        if (result.grants.length > 0) {
          const grantGroups = groupPrivilegesByGrantable(result.grants);
          for (const [grantable, list] of grantGroups) {
            void grantable;
            changes.push(
              new GrantLanguagePrivileges({
                language: branchLanguage,
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
              new RevokeLanguagePrivileges({
                language: mainLanguage,
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
            new RevokeGrantOptionLanguagePrivileges({
              language: mainLanguage,
              grantee,
              privilegeNames: result.revokeGrantOption,
              version: ctx.version,
            }),
          );
        }
      }
    }
  }

  return changes;
}
