import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Constraint } from "../constraint.model.ts";

/**
 * Create a constraint.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertable.html
 *
 * Synopsis
 * ```sql
 * ALTER TABLE table_name ADD CONSTRAINT constraint_name constraint_definition
 * ```
 */
export class CreateConstraint extends CreateChange {
  public readonly constraint: Constraint;

  constructor(props: { constraint: Constraint }) {
    super();
    this.constraint = props.constraint;
  }

  serialize(): string {
    const parts: string[] = [
      "ALTER TABLE",
      `${quoteIdentifier(this.constraint.table_schema)}.${quoteIdentifier(this.constraint.table_name)}`,
      "ADD CONSTRAINT",
      quoteIdentifier(this.constraint.name),
    ];

    // Add constraint definition based on type
    switch (this.constraint.constraint_type) {
      case "p":
        parts.push("PRIMARY KEY");
        break;
      case "u":
        parts.push("UNIQUE");
        break;
      case "f":
        parts.push("FOREIGN KEY");
        break;
      case "c":
        parts.push("CHECK");
        if (this.constraint.check_expression) {
          parts.push(`(${this.constraint.check_expression})`);
        }
        break;
      case "x":
        parts.push("EXCLUDE");
        break;
      default:
        parts.push("UNKNOWN CONSTRAINT TYPE");
    }

    // Add deferrable options
    if (this.constraint.deferrable) {
      parts.push("DEFERRABLE");
      if (this.constraint.initially_deferred) {
        parts.push("INITIALLY DEFERRED");
      } else {
        parts.push("INITIALLY IMMEDIATE");
      }
    } else {
      parts.push("NOT DEFERRABLE");
    }

    return parts.join(" ");
  }
}
