import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { Language } from "../language.model.ts";
import { CreateLanguage } from "./language.create.ts";
import { DropLanguage } from "./language.drop.ts";

/**
 * Alter a language.
 *
 * @see https://www.postgresql.org/docs/current/sql-alterlanguage.html
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
export class AlterLanguageChangeOwner extends AlterChange {
  public readonly main: Language;
  public readonly branch: Language;

  constructor(props: { main: Language; branch: Language }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const parts: string[] = ["ALTER"];

    // PROCEDURAL keyword (optional but can be included for clarity)
    if (this.main.is_procedural) {
      parts.push("PROCEDURAL");
    }

    parts.push(
      "LANGUAGE",
      quoteIdentifier(this.main.name),
      "OWNER TO",
      quoteIdentifier(this.branch.owner),
    );

    return parts.join(" ");
  }
}

/**
 * Replace a language by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER LANGUAGE change.
 */
export class ReplaceLanguage extends ReplaceChange {
  public readonly main: Language;
  public readonly branch: Language;

  constructor(props: { main: Language; branch: Language }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const dropChange = new DropLanguage({ language: this.main });
    const createChange = new CreateLanguage({ language: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
