import { CreateChange, quoteIdentifier } from "../../../base.change.ts";
import type { Enum } from "../enum.model.ts";

/**
 * Create an enum.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtype.html
 *
 * Synopsis
 * ```sql
 * CREATE TYPE name AS ENUM ( [ label [, ...] ] )
 * ```
 */
export class CreateEnum extends CreateChange {
  public readonly enum: Enum;

  constructor(props: { enum: Enum }) {
    super();
    this.enum = props.enum;
  }

  get stableId(): string {
    return `${this.enum.stableId}`;
  }

  serialize(): string {
    const parts: string[] = ["CREATE TYPE"];

    // Add schema and name
    parts.push(
      `${quoteIdentifier(this.enum.schema)}.${quoteIdentifier(this.enum.name)}`,
    );

    // Add AS ENUM
    parts.push("AS ENUM");

    // Add labels
    const labels = this.enum.labels.map((label) =>
      quoteIdentifier(label.label),
    );
    parts.push(`(${labels.join(", ")})`);

    return parts.join(" ");
  }
}
