import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { Table } from "../table.model.ts";
import { CreateTable } from "./table.create.ts";
import { DropTable } from "./table.drop.ts";

/**
 * Alter a table.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertable.html
 *
 * Synopsis
 * ```sql
 * ALTER TABLE [ IF EXISTS ] [ ONLY ] name [ * ]
 *     action [, ... ]
 * where action is one of:
 *     ADD [ COLUMN ] [ IF NOT EXISTS ] column_name data_type [ COLLATE collation ] [ column_constraint [ ... ] ]
 *     DROP [ COLUMN ] [ IF EXISTS ] column_name [ RESTRICT | CASCADE ]
 *     ALTER [ COLUMN ] column_name [ SET DATA ] TYPE data_type [ COLLATE collation ] [ USING expression ]
 *     ALTER [ COLUMN ] column_name SET DEFAULT expression
 *     ALTER [ COLUMN ] column_name DROP DEFAULT
 *     ALTER [ COLUMN ] column_name { SET | DROP } NOT NULL
 *     ALTER [ COLUMN ] column_name SET STATISTICS integer
 *     ALTER [ COLUMN ] column_name SET ( attribute_option = value [, ... ] )
 *     ALTER [ COLUMN ] column_name RESET ( attribute_option [, ... ] )
 *     ALTER [ COLUMN ] column_name SET STORAGE { PLAIN | EXTERNAL | EXTENDED | MAIN }
 *     ALTER [ COLUMN ] column_name SET COMPRESSION compression_method
 *     ADD table_constraint [ NOT VALID ]
 *     ADD table_constraint_using_index
 *     ALTER CONSTRAINT constraint_name [ DEFERRABLE | NOT DEFERRABLE ] [ INITIALLY DEFERRED | INITIALLY IMMEDIATE ]
 *     VALIDATE CONSTRAINT constraint_name
 *     DROP CONSTRAINT [ IF EXISTS ]  constraint_name [ RESTRICT | CASCADE ]
 *     DISABLE TRIGGER [ trigger_name | ALL | USER ]
 *     ENABLE TRIGGER [ trigger_name | ALL | USER ]
 *     ENABLE REPLICA TRIGGER trigger_name
 *     ENABLE ALWAYS TRIGGER trigger_name
 *     DISABLE RULE rewrite_rule_name
 *     ENABLE RULE rewrite_rule_name
 *     ENABLE REPLICA RULE rewrite_rule_name
 *     ENABLE ALWAYS RULE rewrite_rule_name
 *     CLUSTER ON index_name
 *     SET WITHOUT CLUSTER
 *     SET WITH OIDS
 *     SET WITHOUT OIDS
 *     SET ( storage_parameter [= value] [, ... ] )
 *     RESET ( storage_parameter [, ... ] )
 *     INHERIT parent_table
 *     NO INHERIT parent_table
 *     OF type_name
 *     NOT OF
 *     OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 *     SET TABLESPACE new_tablespace
 *     SET { LOGGED | UNLOGGED }
 *     SET ACCESS METHOD new_access_method
 *     REFRESH MATERIALIZED VIEW [ CONCURRENTLY ] [ WITH [ NO ] DATA ]
 *     ATTACH PARTITION partition_name { FOR VALUES partition_bound_spec | DEFAULT }
 *     DETACH PARTITION partition_name [ CONCURRENTLY | FINALIZE ]
 * ```
 */
export type AlterTable = AlterTableChangeOwner;

/**
 * ALTER TABLE ... OWNER TO ...
 */
export class AlterTableChangeOwner extends AlterChange {
  public readonly main: Table;
  public readonly branch: Table;

  constructor(props: { main: Table; branch: Table }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "OWNER TO",
      quoteIdentifier(this.branch.owner),
    ].join(" ");
  }
}

/**
 * Replace a table by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER TABLE change.
 */
export class ReplaceTable extends ReplaceChange {
  public readonly main: Table;
  public readonly branch: Table;

  constructor(props: { main: Table; branch: Table }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const dropChange = new DropTable({ table: this.main });
    const createChange = new CreateTable({ table: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
