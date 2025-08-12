import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { CompositeType } from "../composite-type.model.ts";

/**
 * Create a composite type.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtype.html
 *
 * Synopsis
 * ```sql
 * CREATE TYPE name AS (
 *     attribute_name data_type [ COLLATE collation ] [ NOT NULL ] [ DEFAULT default_expr ] [, ... ]
 * )
 * ```
 */
export class CreateCompositeType extends CreateChange {
  public readonly compositeType: CompositeType;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  serialize(): string {
    const parts: string[] = ["CREATE TYPE"];

    // Add schema and name
    parts.push(
      `${quoteIdentifier(this.compositeType.schema)}.${quoteIdentifier(this.compositeType.name)}`,
    );

    // Add AS keyword
    parts.push("AS");

    parts.push(
      `(${this.compositeType.columns
        .map((column) => `${column.name} ${column.data_type}`)
        .join(", ")})`,
    );

    return parts.join(" ");
  }
}
