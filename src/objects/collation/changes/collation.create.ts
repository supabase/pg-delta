import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Collation } from "../collation.model.ts";

/**
 * Create a collation.
 *
 * @see https://www.postgresql.org/docs/17/sql-createcollation.html
 *
 * Synopsis
 * ```sql
 * CREATE COLLATION [ IF NOT EXISTS ] name (
 *     [ LOCALE = locale, ]
 *     [ LC_COLLATE = lc_collate, ]
 *     [ LC_CTYPE = lc_ctype, ]
 *     [ PROVIDER = provider, ]
 *     [ DETERMINISTIC = boolean, ]
 *     [ RULES = rules, ]
 *     [ VERSION = version ]
 * )
 *
 * CREATE COLLATION [ IF NOT EXISTS ] name FROM existing_collation
 * ```
 */
export class CreateCollation extends CreateChange {
  public readonly collation: Collation;

  constructor(props: { collation: Collation }) {
    super();
    this.collation = props.collation;
  }

  serialize(): string {
    const parts: string[] = ["CREATE COLLATION"];

    // Add schema and name
    parts.push(
      `${quoteIdentifier(this.collation.schema)}.${quoteIdentifier(this.collation.name)}`,
    );

    // Add properties
    const properties: string[] = [];

    // LOCALE
    if (this.collation.locale) {
      properties.push(`LOCALE = ${quoteIdentifier(this.collation.locale)}`);
    }

    // LC_COLLATE
    if (this.collation.collate) {
      properties.push(
        `LC_COLLATE = ${quoteIdentifier(this.collation.collate)}`,
      );
    }

    // LC_CTYPE
    if (this.collation.ctype) {
      properties.push(`LC_CTYPE = ${quoteIdentifier(this.collation.ctype)}`);
    }

    // PROVIDER
    const providerMap: Record<string, string> = {
      d: "icu",
      c: "libc",
      i: "internal",
    };
    if (this.collation.provider) {
      properties.push(
        `PROVIDER = ${providerMap[this.collation.provider] || this.collation.provider}`,
      );
    }

    // DETERMINISTIC
    properties.push(`DETERMINISTIC = ${this.collation.is_deterministic}`);

    // RULES (ICU rules)
    if (this.collation.icu_rules) {
      properties.push(`RULES = ${quoteIdentifier(this.collation.icu_rules)}`);
    }

    // VERSION
    if (this.collation.version) {
      properties.push(`VERSION = ${quoteIdentifier(this.collation.version)}`);
    }

    if (properties.length > 0) {
      parts.push(["(", properties.join(", "), ")"].join(""));
    }

    return parts.join(" ");
  }
}
