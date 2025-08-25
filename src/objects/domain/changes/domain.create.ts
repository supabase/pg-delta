import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Domain } from "../domain.model.ts";

/**
 * Create a domain.
 *
 * @see https://www.postgresql.org/docs/17/sql-createdomain.html
 *
 * Synopsis
 * ```sql
 * CREATE DOMAIN name [ AS ] data_type
 * [ COLLATE collation ]
 * [ DEFAULT expression ]
 * [ domain_constraint [ ... ] ]
 *
 * where domain_constraint is:
 *
 * [ CONSTRAINT constraint_name ]
 * { NOT NULL | NULL | CHECK (expression) }
 * ```
 */
export class CreateDomain extends CreateChange {
  public readonly domain: Domain;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get stableId(): string {
    return `${this.domain.stableId}`;
  }

  serialize(): string {
    const parts: string[] = [];

    // Schema-qualified name
    const domainName = `${quoteIdentifier(this.domain.schema)}.${quoteIdentifier(this.domain.name)}`;

    // Base type (use formatted string for type+typmod and add schema if needed)
    let baseType = this.domain.base_type_str as string;
    if (
      this.domain.base_type_schema &&
      this.domain.base_type_schema !== "pg_catalog"
    ) {
      baseType = `${quoteIdentifier(this.domain.base_type_schema)}.${baseType}`;
    }

    // Array dimensions
    if (this.domain.array_dimensions && this.domain.array_dimensions > 0) {
      baseType += "[]".repeat(this.domain.array_dimensions);
    }

    parts.push(`CREATE DOMAIN ${domainName} AS ${baseType}`);

    // Collation
    if (this.domain.collation) {
      parts.push(`COLLATE ${quoteIdentifier(this.domain.collation)}`);
    }

    // Default value
    if (this.domain.default_value) {
      parts.push(`DEFAULT ${this.domain.default_value}`);
    }

    // NOT NULL constraint
    if (this.domain.not_null) {
      parts.push("NOT NULL");
    }

    return parts.join(" ");
  }
}
