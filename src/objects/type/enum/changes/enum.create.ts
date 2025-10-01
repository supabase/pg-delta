import { Change, quoteLiteral } from "../../../base.change.ts";
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
export class CreateEnum extends Change {
  public readonly enum: Enum;
  public readonly operation = "create" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "enum" as const;

  constructor(props: { enum: Enum }) {
    super();
    this.enum = props.enum;
  }

  get dependencies() {
    return [this.enum.stableId];
  }

  serialize(): string {
    const parts: string[] = ["CREATE TYPE"];

    // Add schema and name
    parts.push(`${this.enum.schema}.${this.enum.name}`);

    // Add AS ENUM
    parts.push("AS ENUM");

    // Add labels
    const labels = this.enum.labels.map((label) => quoteLiteral(label.label));
    parts.push(`(${labels.join(", ")})`);

    return parts.join(" ");
  }
}
