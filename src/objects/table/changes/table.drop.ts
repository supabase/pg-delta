import { Change } from "../../base.change.ts";
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
export class DropTable extends Change {
  public readonly table: Table;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "table" as const;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get dependencies() {
    return [this.table.stableId];
  }

  serialize(): string {
    return ["DROP TABLE", `${this.table.schema}.${this.table.name}`].join(" ");
  }
}
