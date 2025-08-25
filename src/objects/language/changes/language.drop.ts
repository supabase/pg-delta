import { DropChange, quoteIdentifier } from "../../base.change.ts";
import type { Language } from "../language.model.ts";

/**
 * Drop a language.
 *
 * @see https://www.postgresql.org/docs/17/sql-droplanguage.html
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

  get stableId(): string {
    return `${this.language.stableId}`;
  }

  serialize(): string {
    const parts: string[] = ["DROP"];

    // Do not print optional keywords (e.g., PROCEDURAL). Keep the statement minimal.
    parts.push("LANGUAGE", quoteIdentifier(this.language.name));

    return parts.join(" ");
  }
}
