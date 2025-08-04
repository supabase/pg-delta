import { DropChange, quoteIdentifier } from "../../base.change.ts";
import type { Language } from "../language.model.ts";

/**
 * Drop a language.
 *
 * @see https://www.postgresql.org/docs/current/sql-droplanguage.html
 *
 * Synopsis
 * ```sql
 * DROP [ PROCEDURAL ] LANGUAGE [ IF EXISTS ] name [ CASCADE | RESTRICT ]
 * ```
 */
export class DropLanguage extends DropChange {
  public readonly language: Language;

  constructor(props: { language: Language }) {
    super();
    this.language = props.language;
  }

  serialize(): string {
    const parts: string[] = ["DROP"];

    // PROCEDURAL keyword (optional but can be included for clarity)
    if (this.language.is_procedural) {
      parts.push("PROCEDURAL");
    }

    parts.push("LANGUAGE", quoteIdentifier(this.language.name));

    return parts.join(" ");
  }
}
