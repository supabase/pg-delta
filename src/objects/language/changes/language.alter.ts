import { AlterChange, ReplaceChange } from "../../base.change.ts";
import type { Language } from "../language.model.ts";
import { CreateLanguage } from "./language.create.ts";
import { DropLanguage } from "./language.drop.ts";

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
export class AlterLanguageChangeOwner extends AlterChange {
  public readonly main: Language;
  public readonly branch: Language;

  constructor(props: { main: Language; branch: Language }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [`${this.main.stableId}`, `role:${this.branch.owner}`];
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

  get dependencies() {
    return [`${this.main.stableId}`];
  }

  serialize(): string {
    const dropChange = new DropLanguage({ language: this.main });
    const createChange = new CreateLanguage({ language: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
