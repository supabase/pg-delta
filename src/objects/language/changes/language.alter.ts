import { Change } from "../../base.change.ts";
import type { Language } from "../language.model.ts";

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

/**
 * ALTER LANGUAGE ... OWNER TO ...
 */
export class AlterLanguageChangeOwner extends Change {
  public readonly main: Language;
  public readonly branch: Language;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "language" as const;

  constructor(props: { main: Language; branch: Language }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    const parts: string[] = ["ALTER"];

    // Do not print the optional PROCEDURAL keyword.
    // It is syntactic noise and the default for procedural languages,
    // so we purposely omit it to avoid emitting defaults.

    parts.push("LANGUAGE", this.main.name, "OWNER TO", this.branch.owner);

    return parts.join(" ");
  }
}

/**
 * Replace a language.
 * This is used when properties that cannot be altered via ALTER LANGUAGE change.
 */
// NOTE: ReplaceLanguage removed. Non-alterable changes are emitted as Drop + Create in language.diff.ts.
