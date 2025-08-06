import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Index } from "../index.model.ts";

/**
 * Create an index.
 *
 * @see https://www.postgresql.org/docs/17/sql-createindex.html
 *
 * Synopsis
 * ```sql
 * CREATE [ UNIQUE ] INDEX [ CONCURRENTLY ] [ [ IF NOT EXISTS ] name ] ON [ ONLY ] table_name [ USING method ]
 *     ( { column_name | ( expression ) } [ COLLATE collation ] [ opclass [ ( opclass_parameter = value [, ... ] ) ] ] [ ASC | DESC ] [ NULLS { FIRST | LAST } ] [, ...] )
 *     [ INCLUDE ( column_name [, ...] ) ]
 *     [ WITH ( storage_parameter [= value] [, ... ] ) ]
 *     [ TABLESPACE tablespace_name ]
 *     [ WHERE predicate ]
 * ```
 */
export class CreateIndex extends CreateChange {
  public readonly index: Index;

  constructor(props: { index: Index }) {
    super();
    this.index = props.index;
  }

  serialize(): string {
    const parts: string[] = ["CREATE"];

    // Add UNIQUE if applicable
    if (this.index.is_unique) {
      parts.push("UNIQUE");
    }

    parts.push("INDEX");

    // Add index name
    parts.push(quoteIdentifier(this.index.name));

    // Add ON table
    parts.push(
      "ON",
      `${quoteIdentifier(this.index.table_schema)}.${quoteIdentifier(this.index.table_name)}`,
    );

    // Add USING method if specified
    if (this.index.index_type && this.index.index_type !== "btree") {
      parts.push("USING", this.index.index_type);
    }

    // Add columns (simplified - would need actual column names)
    parts.push("()");

    // Add WHERE clause if partial index
    if (this.index.partial_predicate) {
      parts.push("WHERE", this.index.partial_predicate);
    }

    // Add storage parameters
    if (this.index.storage_params.length > 0) {
      parts.push("WITH", `(${this.index.storage_params.join(", ")})`);
    }

    // Add tablespace
    if (this.index.tablespace) {
      parts.push("TABLESPACE", quoteIdentifier(this.index.tablespace));
    }

    return parts.join(" ");
  }
}
