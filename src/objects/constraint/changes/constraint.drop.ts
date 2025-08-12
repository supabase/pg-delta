import { DropChange, quoteIdentifier } from "../../base.change.ts";
import type { Constraint } from "../constraint.model.ts";

/**
 * Drop a constraint.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertable.html
 *
 * Synopsis
 * ```sql
 * ALTER TABLE table_name DROP CONSTRAINT [ IF EXISTS ] constraint_name [ RESTRICT | CASCADE ]
 * ```
 */
export class DropConstraint extends DropChange {
  public readonly constraint: Constraint;

  constructor(props: { constraint: Constraint }) {
    super();
    this.constraint = props.constraint;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.constraint.table_schema)}.${quoteIdentifier(this.constraint.table_name)}`,
      "DROP CONSTRAINT",
      quoteIdentifier(this.constraint.name),
    ].join(" ");
  }
}
