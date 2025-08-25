import { AlterChange, quoteIdentifier } from "../../base.change.ts";
import type { ColumnProps } from "../../base.model.ts";
import type { Table, TableConstraintProps } from "../table.model.ts";
// No drop+create paths; destructive operations are out of scope

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
export type AlterTable =
  | AlterTableChangeOwner
  | AlterTableSetLogged
  | AlterTableSetUnlogged
  | AlterTableEnableRowLevelSecurity
  | AlterTableDisableRowLevelSecurity
  | AlterTableForceRowLevelSecurity
  | AlterTableNoForceRowLevelSecurity
  | AlterTableSetStorageParams
  | AlterTableAddConstraint
  | AlterTableDropConstraint
  | AlterTableValidateConstraint
  | AlterTableSetReplicaIdentity
  | AlterTableAddColumn
  | AlterTableDropColumn
  | AlterTableAlterColumnType
  | AlterTableAlterColumnSetDefault
  | AlterTableAlterColumnDropDefault
  | AlterTableAlterColumnSetNotNull
  | AlterTableAlterColumnDropNotNull;

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

  get stableId(): string {
    return `${this.main.stableId}`;
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
 * ALTER TABLE ... SET LOGGED
 */
export class AlterTableSetLogged extends AlterChange {
  public readonly main: Table;
  public readonly branch: Table;

  constructor(props: { main: Table; branch: Table }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "SET LOGGED",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... SET UNLOGGED
 */
export class AlterTableSetUnlogged extends AlterChange {
  public readonly main: Table;
  public readonly branch: Table;

  constructor(props: { main: Table; branch: Table }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "SET UNLOGGED",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ENABLE ROW LEVEL SECURITY
 */
export class AlterTableEnableRowLevelSecurity extends AlterChange {
  public readonly main: Table;
  public readonly branch: Table;

  constructor(props: { main: Table; branch: Table }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "ENABLE ROW LEVEL SECURITY",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... DISABLE ROW LEVEL SECURITY
 */
export class AlterTableDisableRowLevelSecurity extends AlterChange {
  public readonly main: Table;
  public readonly branch: Table;

  constructor(props: { main: Table; branch: Table }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "DISABLE ROW LEVEL SECURITY",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... FORCE ROW LEVEL SECURITY
 */
export class AlterTableForceRowLevelSecurity extends AlterChange {
  public readonly main: Table;
  public readonly branch: Table;

  constructor(props: { main: Table; branch: Table }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "FORCE ROW LEVEL SECURITY",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... NO FORCE ROW LEVEL SECURITY
 */
export class AlterTableNoForceRowLevelSecurity extends AlterChange {
  public readonly main: Table;
  public readonly branch: Table;

  constructor(props: { main: Table; branch: Table }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "NO FORCE ROW LEVEL SECURITY",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... SET ( storage_parameter = value [, ... ] )
 */
export class AlterTableSetStorageParams extends AlterChange {
  public readonly main: Table;
  public readonly branch: Table;

  constructor(props: { main: Table; branch: Table }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const storageParams = (this.branch.options ?? []).join(", ");
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      `SET (${storageParams})`,
    ].join(" ");
  }
}

// Intentionally no ReplaceTable: destructive changes are not emitted

/**
 * ALTER TABLE ... ADD CONSTRAINT ...
 */
export class AlterTableAddConstraint extends AlterChange {
  public readonly table: Table;
  public readonly constraint: TableConstraintProps;

  constructor(props: { table: Table; constraint: TableConstraintProps }) {
    super();
    this.table = props.table;
    this.constraint = props.constraint;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  serialize(): string {
    const parts: string[] = [
      "ALTER TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
      "ADD CONSTRAINT",
      quoteIdentifier(this.constraint.name),
    ];
    switch (this.constraint.constraint_type) {
      case "p":
        parts.push("PRIMARY KEY");
        break;
      case "u":
        parts.push("UNIQUE");
        break;
      case "f":
        parts.push("FOREIGN KEY");
        break;
      case "c":
        parts.push("CHECK");
        if (this.constraint.check_expression) {
          parts.push(`(${this.constraint.check_expression})`);
        }
        break;
      case "x":
        parts.push("EXCLUDE");
        break;
    }
    if (this.constraint.deferrable) {
      parts.push("DEFERRABLE");
      parts.push(
        this.constraint.initially_deferred
          ? "INITIALLY DEFERRED"
          : "INITIALLY IMMEDIATE",
      );
    } else {
      parts.push("NOT DEFERRABLE");
    }
    return parts.join(" ");
  }
}

/**
 * ALTER TABLE ... DROP CONSTRAINT ...
 */
export class AlterTableDropConstraint extends AlterChange {
  public readonly table: Table;
  public readonly constraint: TableConstraintProps;

  constructor(props: { table: Table; constraint: TableConstraintProps }) {
    super();
    this.table = props.table;
    this.constraint = props.constraint;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
      "DROP CONSTRAINT",
      quoteIdentifier(this.constraint.name),
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... VALIDATE CONSTRAINT ...
 */
export class AlterTableValidateConstraint extends AlterChange {
  public readonly table: Table;
  public readonly constraint: TableConstraintProps;

  constructor(props: { table: Table; constraint: TableConstraintProps }) {
    super();
    this.table = props.table;
    this.constraint = props.constraint;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
      "VALIDATE CONSTRAINT",
      quoteIdentifier(this.constraint.name),
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... REPLICA IDENTITY ...
 */
export class AlterTableSetReplicaIdentity extends AlterChange {
  public readonly main: Table;
  public readonly branch: Table;

  constructor(props: { main: Table; branch: Table }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const mode = this.branch.replica_identity;
    const clause =
      mode === "d"
        ? "DEFAULT"
        : mode === "n"
          ? "NOTHING"
          : mode === "f"
            ? "FULL"
            : "DEFAULT"; // 'i' (USING INDEX) is handled via index changes; fallback to DEFAULT
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "REPLICA IDENTITY",
      clause,
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ADD COLUMN ...
 */
export class AlterTableAddColumn extends AlterChange {
  public readonly table: Table;
  public readonly column: ColumnProps;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  serialize(): string {
    const parts: string[] = [
      "ALTER TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
      "ADD COLUMN",
      quoteIdentifier(this.column.name),
      this.column.data_type_str,
    ];
    if (this.column.collation) {
      parts.push("COLLATE", quoteIdentifier(this.column.collation));
    }
    if (this.column.default !== null) {
      parts.push("DEFAULT", this.column.default);
    }
    if (this.column.not_null) {
      parts.push("NOT NULL");
    }
    return parts.join(" ");
  }
}

/**
 * ALTER TABLE ... DROP COLUMN ...
 */
export class AlterTableDropColumn extends AlterChange {
  public readonly table: Table;
  public readonly column: ColumnProps;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
      "DROP COLUMN",
      quoteIdentifier(this.column.name),
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ALTER COLUMN ... TYPE ...
 */
export class AlterTableAlterColumnType extends AlterChange {
  public readonly table: Table;
  public readonly column: ColumnProps;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  serialize(): string {
    const parts: string[] = [
      "ALTER TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
      "ALTER COLUMN",
      quoteIdentifier(this.column.name),
      "TYPE",
      this.column.data_type_str,
    ];
    if (this.column.collation) {
      parts.push("COLLATE", quoteIdentifier(this.column.collation));
    }
    return parts.join(" ");
  }
}

/**
 * ALTER TABLE ... ALTER COLUMN ... SET DEFAULT ...
 */
export class AlterTableAlterColumnSetDefault extends AlterChange {
  public readonly table: Table;
  public readonly column: ColumnProps;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
      "ALTER COLUMN",
      quoteIdentifier(this.column.name),
      "SET DEFAULT",
      this.column.default ?? "NULL",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ALTER COLUMN ... DROP DEFAULT
 */
export class AlterTableAlterColumnDropDefault extends AlterChange {
  public readonly table: Table;
  public readonly column: ColumnProps;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
      "ALTER COLUMN",
      quoteIdentifier(this.column.name),
      "DROP DEFAULT",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ALTER COLUMN ... SET NOT NULL
 */
export class AlterTableAlterColumnSetNotNull extends AlterChange {
  public readonly table: Table;
  public readonly column: ColumnProps;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
      "ALTER COLUMN",
      quoteIdentifier(this.column.name),
      "SET NOT NULL",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL
 */
export class AlterTableAlterColumnDropNotNull extends AlterChange {
  public readonly table: Table;
  public readonly column: ColumnProps;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
      "ALTER COLUMN",
      quoteIdentifier(this.column.name),
      "DROP NOT NULL",
    ].join(" ");
  }
}
