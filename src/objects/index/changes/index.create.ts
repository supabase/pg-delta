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
    return this.index.definition;
  }
}
