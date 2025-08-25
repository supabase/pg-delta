import { DropChange, quoteIdentifier } from "../../base.change.ts";
import type { Table } from "../table.model.ts";

/**
 * Drop a table.
 *
 * @see https://www.postgresql.org/docs/17/sql-droptable.html
 *
 * Synopsis
 * ```sql
 * DROP TABLE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropTable extends DropChange {
  public readonly table: Table;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  serialize(): string {
    return [
      "DROP TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
    ].join(" ");
  }
}
