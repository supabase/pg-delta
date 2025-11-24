import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignTable } from "../foreign-table.model.ts";
import { CreateForeignTableChange } from "./foreign-table.base.ts";

/**
 * Create a foreign table.
 *
 * @see https://www.postgresql.org/docs/17/sql-createforeigntable.html
 *
 * Synopsis
 * ```sql
 * CREATE FOREIGN TABLE [ IF NOT EXISTS ] table_name
 *     ( [ { column_name data_type [ OPTIONS ( option 'value' [, ... ] ) ] [ COLLATE collation ] [ column_constraint [ ... ] ] | table_constraint } [, ... ] ] )
 *     SERVER server_name
 *     [ OPTIONS ( option 'value' [, ... ] ) ]
 * ```
 */
export class CreateForeignTable extends CreateForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly scope = "object" as const;

  constructor(props: { foreignTable: ForeignTable }) {
    super();
    this.foreignTable = props.foreignTable;
  }

  get creates() {
    return [this.foreignTable.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.foreignTable.schema));

    // Server dependency
    dependencies.add(stableId.server(this.foreignTable.server));

    // Owner dependency
    dependencies.add(stableId.role(this.foreignTable.owner));

    return Array.from(dependencies);
  }

  serialize(): string {
    const parts: string[] = ["CREATE FOREIGN TABLE"];

    // Add schema and name
    parts.push(`${this.foreignTable.schema}.${this.foreignTable.name}`);

    // Add columns
    const columnDefs: string[] = [];
    for (const col of this.foreignTable.columns) {
      const colParts: string[] = [col.name, col.data_type_str];
      columnDefs.push(colParts.join(" "));
    }
    parts.push(`(${columnDefs.join(", ")})`);

    // Add SERVER clause
    parts.push("SERVER", this.foreignTable.server);

    // Add OPTIONS clause (table-level)
    if (this.foreignTable.options && this.foreignTable.options.length > 0) {
      const optionPairs: string[] = [];
      for (let i = 0; i < this.foreignTable.options.length; i += 2) {
        if (i + 1 < this.foreignTable.options.length) {
          optionPairs.push(
            `${this.foreignTable.options[i]} ${quoteLiteral(this.foreignTable.options[i + 1])}`,
          );
        }
      }
      if (optionPairs.length > 0) {
        parts.push(`OPTIONS (${optionPairs.join(", ")})`);
      }
    }

    return parts.join(" ");
  }
}
