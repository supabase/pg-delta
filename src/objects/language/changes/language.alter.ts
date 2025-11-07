import type { Language } from "../language.model.ts";
import { AlterLanguageChange } from "./language.base.ts";

/**
 * Alter a language.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterlanguage.html
 *
 * Synopsis
 * ```sql
 * ALTER [ PROCEDURAL ] LANGUAGE name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER [ PROCEDURAL ] LANGUAGE name RENAME TO new_name
 * ```
 */

export type AlterLanguage = AlterLanguageChangeOwner;

/**
 * ALTER LANGUAGE ... OWNER TO ...
 */
export class AlterLanguageChangeOwner extends AlterLanguageChange {
  public readonly language: Language;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { language: Language; owner: string }) {
    super();
    this.language = props.language;
    this.owner = props.owner;
  }

  get requires() {
    return [this.language.stableId];
  }

  serialize(): string {
    const parts: string[] = ["ALTER"];

    // Do not print the optional PROCEDURAL keyword.
    // It is syntactic noise and the default for procedural languages,
    // so we purposely omit it to avoid emitting defaults.

    parts.push("LANGUAGE", this.language.name, "OWNER TO", this.owner);

    return parts.join(" ");
  }
}

/**
 * Replace a language.
 * This is used when properties that cannot be altered via ALTER LANGUAGE change.
 */
// NOTE: ReplaceLanguage removed. Non-alterable changes are emitted as Drop + Create in language.diff.ts.
