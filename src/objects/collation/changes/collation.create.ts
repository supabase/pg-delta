import { Change, quoteLiteral } from "../../base.change.ts";
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
export class CreateCollation extends Change {
  public readonly collation: Collation;
  public readonly operation = "create" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "collation" as const;

  constructor(props: { collation: Collation }) {
    super();
    this.collation = props.collation;
  }

  get dependencies() {
    return [this.collation.stableId];
  }

  serialize(): string {
    const parts: string[] = ["CREATE COLLATION"];

    // Add schema and name (already quoted in model extraction)
    parts.push(`${this.collation.schema}.${this.collation.name}`);

    // Add properties
    const properties: string[] = [];

    // LOCALE
    if (this.collation.locale) {
      properties.push(`LOCALE = ${quoteLiteral(this.collation.locale)}`);
    }

    // LC_COLLATE
    if (this.collation.collate) {
      properties.push(`LC_COLLATE = ${quoteLiteral(this.collation.collate)}`);
    }

    // LC_CTYPE
    if (this.collation.ctype) {
      properties.push(`LC_CTYPE = ${quoteLiteral(this.collation.ctype)}`);
    }

    // PROVIDER
    const providerMap: Record<string, string> = {
      c: "libc",
      i: "icu",
      b: "builtin",
    };
    // provider 'd' means default provider in catalog; omit PROVIDER clause
    if (this.collation.provider !== "d") {
      properties.push(`PROVIDER = ${providerMap[this.collation.provider]}`);
    }

    // DETERMINISTIC
    // DETERMINISTIC (only emit when false; true is default in PG)
    if (this.collation.is_deterministic === false) {
      properties.push(`DETERMINISTIC = false`);
    }

    // RULES (ICU rules)
    if (this.collation.icu_rules) {
      properties.push(`RULES = ${quoteLiteral(this.collation.icu_rules)}`);
    }

    // VERSION
    if (this.collation.version) {
      properties.push(`VERSION = ${quoteLiteral(this.collation.version)}`);
    }

    parts.push(["(", properties.join(", "), ")"].join(""));

    return parts.join(" ");
  }
}
