import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Table } from "../table.model.ts";

/**
 * Create a table.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtable.html
 *
 * Synopsis
 * ```sql
 * CREATE [ [ GLOBAL | LOCAL ] { TEMPORARY | TEMP } | UNLOGGED ] TABLE [ IF NOT EXISTS ] table_name ( [
 *   { column_name data_type [ COLLATE collation ] [ column_constraint [ ... ] ]
 *     | table_constraint
 *     | LIKE source_table [ like_option ... ] }
 *     [, ... ]
 * ] )
 * [ INHERITS ( parent_table [, ... ] ) ]
 * [ PARTITION BY { RANGE | LIST | HASH } ( { column_name | ( expression ) } [, ... ] ) ]
 * [ USING method ]
 * [ WITH ( storage_parameter [= value] [, ... ] ) | WITHOUT OIDS ]
 * [ ON COMMIT { PRESERVE ROWS | DELETE ROWS | DROP } ]
 * [ TABLESPACE tablespace_name ]
 * ```
 */
export class CreateTable extends CreateChange {
  public readonly table: Table;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  serialize(): string {
    const parts: string[] = ["CREATE"];

    // Add TEMPORARY/UNLOGGED based on persistence
    if (this.table.persistence === "t") {
      parts.push("TEMPORARY");
    } else if (this.table.persistence === "u") {
      parts.push("UNLOGGED");
    }

    parts.push("TABLE");

    // Add schema and name
    parts.push(
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
    );

    // Add columns (simplified - would need actual column definitions)
    parts.push("()");

    // Add INHERITS if parent table exists
    if (this.table.parent_schema && this.table.parent_name) {
      parts.push(
        "INHERITS",
        `(${quoteIdentifier(this.table.parent_schema)}.${quoteIdentifier(this.table.parent_name)})`,
      );
    }

    // Add storage parameters if specified
    if (this.table.options && this.table.options.length > 0) {
      parts.push("WITH", `(${this.table.options.join(", ")})`);
    }

    return parts.join(" ");
  }
}
