import { CreateChange } from "../../base.change.ts";
import type { TableLikeObject } from "../../base.model.ts";
import type { Index } from "../index.model.ts";
import { checkIsSerializable } from "./utils.ts";

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
    checkIsSerializable(props.index, props.indexableObject);
    this.index = props.index;
    this.indexableObject = props.indexableObject;
  }

  get stableId(): string {
    return `${this.index.stableId}`;
  }

  /**
   * Get column names from key_columns array using the indexable object's columns.
   */
  private getColumnNames(): string[] {
    if (this.index.index_expressions) {
      // If there are index expressions, use them directly
      return [this.index.index_expressions];
    }

    // Create a mapping from column position to column name
    const columnMap = new Map<number, string>();
    // biome-ignore lint/style/noNonNullAssertion: checked in constructor
    for (const column of this.indexableObject!.columns) {
      columnMap.set(column.position, column.name);
    }

    // Resolve column numbers to names
    const columnNames: string[] = [];
    for (const colNum of this.index.key_columns) {
      const columnName = columnMap.get(colNum);
      if (!columnName) {
        throw new Error(
          `CreateIndex could not resolve column position ${colNum} to a column name`,
        );
      }
      columnNames.push(columnName);
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
    parts.push(this.index.name);

    // Add ON table/materialized view
    parts.push("ON", `${this.index.schema}.${this.index.table_name}`);

    // Add columns (with per-column options)
    const columnNames = this.getColumnNames();
    const isExpressionOnly = this.index.index_expressions !== null;
    const columnItems = isExpressionOnly
      ? columnNames
      : columnNames.map((col, i) => {
          const itemParts: string[] = [col];
          const collation = this.index.column_collations[i];
          if (collation) {
            itemParts.push(`COLLATE ${collation}`);
          }
          const opclass = this.index.operator_classes[i];
          if (opclass) {
            itemParts.push(opclass);
          }
          const optionBits = this.index.column_options[i] ?? 0;
          const isDesc = (optionBits & 1) === 1; // INDOPTION_DESC
          const isNullsFirst = (optionBits & 2) === 2; // INDOPTION_NULLS_FIRST
          if (isDesc) {
            itemParts.push("DESC");
          }
          if (isNullsFirst) {
            itemParts.push("NULLS FIRST");
          } else if (isDesc) {
            // For DESC, default is NULLS FIRST; if flag is not set, emit NULLS LAST
            itemParts.push("NULLS LAST");
          }
          return itemParts.join(" ");
        });

    // Add USING method if specified (concatenated with opening parenthesis)
    if (this.index.index_type && this.index.index_type !== "btree") {
      parts.push(`USING ${this.index.index_type}(${columnItems.join(", ")})`);
    } else {
      parts.push(`(${columnItems.join(", ")})`);
    }

    // UNIQUE indexes can specify NULLS NOT DISTINCT
    if (this.index.is_unique && this.index.nulls_not_distinct) {
      parts.push("NULLS NOT DISTINCT");
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
      parts.push("TABLESPACE", this.index.tablespace);
    }

    return parts.join(" ");
  }
}
