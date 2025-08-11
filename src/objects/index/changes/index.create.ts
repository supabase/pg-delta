import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { TableLikeObject } from "../../base.model.ts";
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
  public readonly indexableObject?: TableLikeObject;

  constructor(props: { index: Index; indexableObject?: TableLikeObject }) {
    super();
    this.index = props.index;
    this.indexableObject = props.indexableObject;
  }

  /**
   * Get column names from key_columns array using the indexable object's columns.
   */
  private getColumnNames(): string[] {
    if (this.index.index_expressions) {
      // If there are index expressions, use them directly
      return [this.index.index_expressions];
    }

    if (!this.indexableObject || this.indexableObject.columns.length === 0) {
      // If no indexable object provided or no columns, fall back to generic column names
      return this.index.key_columns.map(
        (colNum, index) => `column${colNum || index + 1}`,
      );
    }

    // Create a mapping from column position to column name
    const columnMap = new Map<number, string>();
    for (const column of this.indexableObject.columns) {
      columnMap.set(column.position, column.name);
    }

    // Resolve column numbers to names
    const columnNames: string[] = [];
    for (const colNum of this.index.key_columns) {
      const columnName = columnMap.get(colNum);
      if (columnName) {
        columnNames.push(quoteIdentifier(columnName));
      } else {
        // Fallback if column not found
        columnNames.push(`column${colNum}`);
      }
    }

    return columnNames;
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

    // Add ON table/materialized view
    parts.push(
      "ON",
      `${quoteIdentifier(this.index.table_schema)}.${quoteIdentifier(this.index.table_name)}`,
    );

    // Add columns
    const columnNames = this.getColumnNames();

    // Add USING method if specified (concatenated with opening parenthesis)
    if (this.index.index_type && this.index.index_type !== "btree") {
      parts.push(`USING ${this.index.index_type}(${columnNames.join(", ")})`);
    } else {
      parts.push(`(${columnNames.join(", ")})`);
    }

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
