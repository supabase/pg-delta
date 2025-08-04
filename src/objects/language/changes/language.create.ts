import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Language } from "../language.model.ts";

/**
 * Create a language.
 *
 * @see https://www.postgresql.org/docs/current/sql-createlanguage.html
 *
 * Synopsis
 * ```sql
 * CREATE [ OR REPLACE ] [ TRUSTED ] [ PROCEDURAL ] LANGUAGE name
 * [ HANDLER call_handler [ INLINE inline_handler ] [ VALIDATOR valfunction ] ]
 * ```
 */
export class CreateLanguage extends CreateChange {
  public readonly language: Language;

  constructor(props: { language: Language }) {
    super();
    this.language = props.language;
  }

  serialize(): string {
    const parts: string[] = ["CREATE"];

    // TRUSTED keyword
    if (this.language.is_trusted) {
      parts.push("TRUSTED");
    }

    // PROCEDURAL keyword
    if (this.language.is_procedural) {
      parts.push("PROCEDURAL");
    }

    parts.push("LANGUAGE", quoteIdentifier(this.language.name));

    // HANDLER
    if (this.language.call_handler) {
      parts.push("HANDLER", this.language.call_handler);
    }

    // INLINE
    if (this.language.inline_handler) {
      parts.push("INLINE", this.language.inline_handler);
    }

    // VALIDATOR
    if (this.language.validator) {
      parts.push("VALIDATOR", this.language.validator);
    }

    return parts.join(" ");
  }
}
