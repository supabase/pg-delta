import { AlterChange, quoteIdentifier } from "../../base.change.ts";
import type { ColumnProps } from "../../base.model.ts";
import type { Table, TableConstraintProps } from "../table.model.ts";

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
  public readonly foreignKeyTable?: Table;
  public readonly constraint: TableConstraintProps;

  constructor(props: {
    table: Table;
    constraint: TableConstraintProps;
    foreignKeyTable?: Table;
  }) {
    super();

    if (props.constraint.constraint_type === "f" && !props.foreignKeyTable) {
      throw new Error(
        "foreignKeyTable is required for FOREIGN KEY constraints",
      );
    }

    this.table = props.table;
    this.constraint = props.constraint;
    this.foreignKeyTable = props.foreignKeyTable;
  }

  get stableId(): string {
    return `${this.table.stableId}`;
  }

  private getColumnNames(): string[] {
    const columnByPosition = new Map(
      this.table.columns.map((c) => [c.position, c]),
    );
    return this.constraint.key_columns.map((position) => {
      const column = columnByPosition.get(position);
      if (!column) {
        throw new Error(
          `AlterTableAddConstraint could not resolve column position ${position} to a column name`,
        );
      }
      return quoteIdentifier(column.name);
    });
  }
  private getForeignKeyColumnNames(): string[] {
    const columnByPosition = new Map(
      this.foreignKeyTable!.columns.map((c) => [c.position, c]),
    );
    return this.constraint.foreign_key_columns!.map((position) => {
      // biome-ignore lint/style/noNonNullAssertion: it is guaranteed by our query
      const column = columnByPosition.get(position)!;
      return column.name;
    });
  }

  serialize(): string {
    const parts: string[] = [
      "ALTER TABLE",
      `${quoteIdentifier(this.table.schema)}.${quoteIdentifier(this.table.name)}`,
      "ADD CONSTRAINT",
      quoteIdentifier(this.constraint.name),
    ];
    switch (this.constraint.constraint_type) {
      case "p": {
        parts.push("PRIMARY KEY");
        // A primary key constraint is defined by the columns it references
        parts.push(`(${this.getColumnNames().join(", ")})`);
        break;
      }
      case "u":
        parts.push("UNIQUE");
        parts.push(`(${this.getColumnNames().join(", ")})`);
        break;
      case "f":
        parts.push("FOREIGN KEY");
        parts.push(`(${this.getColumnNames().join(", ")})`);
        parts.push(
          `REFERENCES ${this.constraint.foreign_key_schema}.${this.constraint.foreign_key_table}`,
        );
        parts.push(`(${this.getForeignKeyColumnNames().join(", ")})`);
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
    }
    if (this.constraint.constraint_type === "f") {
      switch (this.constraint.on_update) {
        case "r":
          parts.push("ON UPDATE RESTRICT");
          break;
        case "c":
          parts.push("ON UPDATE CASCADE");
          break;
        case "n":
          parts.push("ON UPDATE SET NULL");
          break;
        case "d":
          parts.push("ON UPDATE SET DEFAULT");
          break;
        default:
          break;
      }
      switch (this.constraint.on_delete) {
        case "r":
          parts.push("ON DELETE RESTRICT");
          break;
        case "c":
          parts.push("ON DELETE CASCADE");
          break;
        case "n":
          parts.push("ON DELETE SET NULL");
          break;
        case "d":
          parts.push("ON DELETE SET DEFAULT");
          break;
        default:
          break;
      }
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
