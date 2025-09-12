import { CreateChange } from "../../base.change.ts";
import type { Language } from "../language.model.ts";

/**
 * Create a language.
 *
 * @see https://www.postgresql.org/docs/17/sql-createlanguage.html
 *
 * Synopsis
 * ```sql
 * CREATE [ OR REPLACE ] [ TRUSTED ] [ PROCEDURAL ] LANGUAGE name
 * [ HANDLER call_handler [ INLINE inline_handler ] [ VALIDATOR valfunction ] ]
 * ```
 */
export class CreateLanguage extends CreateChange {
  public readonly language: Language;
  public readonly orReplace?: boolean;

  constructor(props: { language: Language; orReplace?: boolean }) {
    super();
    this.language = props.language;
    this.orReplace = props.orReplace;
  }

  get stableId(): string {
    return `${this.language.stableId}`;
  }

  serialize(): string {
    const parts: string[] = [`CREATE${this.orReplace ? " OR REPLACE" : ""}`];

    // Only include non-default flags. We never print the optional
    // PROCEDURAL keyword or any defaults.

    // TRUSTED keyword (default is untrusted -> omitted unless true)
    if (this.language.is_trusted) {
      parts.push("TRUSTED");
    }

    parts.push("LANGUAGE", this.language.name);

    // HANDLER (omit when null)
    if (this.language.call_handler) {
      parts.push("HANDLER", this.language.call_handler);
    }

    // INLINE (omit when null)
    if (this.language.inline_handler) {
      parts.push("INLINE", this.language.inline_handler);
    }

    // VALIDATOR (omit when null)
    if (this.language.validator) {
      parts.push("VALIDATOR", this.language.validator);
    }

    return parts.join(" ");
  }
}
