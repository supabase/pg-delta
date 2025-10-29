import type { ColumnProps } from "../../base.model.ts";
import { stableId } from "../../utils.ts";
import type { Table, TableConstraintProps } from "../table.model.ts";
import { AlterTableChange } from "./table.base.ts";

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
  | AlterTableAddColumn
  | AlterTableAddConstraint
  | AlterTableAlterColumnDropDefault
  | AlterTableAlterColumnDropNotNull
  | AlterTableAlterColumnSetDefault
  | AlterTableAlterColumnSetNotNull
  | AlterTableAlterColumnType
  | AlterTableAttachPartition
  | AlterTableChangeOwner
  | AlterTableDetachPartition
  | AlterTableDisableRowLevelSecurity
  | AlterTableDropColumn
  | AlterTableDropConstraint
  | AlterTableEnableRowLevelSecurity
  | AlterTableForceRowLevelSecurity
  | AlterTableNoForceRowLevelSecurity
  | AlterTableResetStorageParams
  | AlterTableSetLogged
  | AlterTableSetReplicaIdentity
  | AlterTableSetStorageParams
  | AlterTableSetUnlogged
  | AlterTableValidateConstraint;

/**
 * ALTER TABLE ... OWNER TO ...
 */
export class AlterTableChangeOwner extends AlterTableChange {
  public readonly table: Table;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; owner: string }) {
    super();
    this.table = props.table;
    this.owner = props.owner;
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "OWNER TO",
      this.owner,
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... SET LOGGED
 */
export class AlterTableSetLogged extends AlterTableChange {
  public readonly table: Table;
  public readonly scope = "object" as const;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "SET LOGGED",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... SET UNLOGGED
 */
export class AlterTableSetUnlogged extends AlterTableChange {
  public readonly table: Table;
  public readonly scope = "object" as const;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "SET UNLOGGED",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ENABLE ROW LEVEL SECURITY
 */
export class AlterTableEnableRowLevelSecurity extends AlterTableChange {
  public readonly table: Table;
  public readonly scope = "object" as const;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "ENABLE ROW LEVEL SECURITY",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... DISABLE ROW LEVEL SECURITY
 */
export class AlterTableDisableRowLevelSecurity extends AlterTableChange {
  public readonly table: Table;
  public readonly scope = "object" as const;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "DISABLE ROW LEVEL SECURITY",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... FORCE ROW LEVEL SECURITY
 */
export class AlterTableForceRowLevelSecurity extends AlterTableChange {
  public readonly table: Table;
  public readonly scope = "object" as const;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "FORCE ROW LEVEL SECURITY",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... NO FORCE ROW LEVEL SECURITY
 */
export class AlterTableNoForceRowLevelSecurity extends AlterTableChange {
  public readonly table: Table;
  public readonly scope = "object" as const;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "NO FORCE ROW LEVEL SECURITY",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... SET ( storage_parameter = value [, ... ] )
 */
export class AlterTableSetStorageParams extends AlterTableChange {
  public readonly table: Table;
  public readonly options: string[];
  public readonly scope = "object" as const;

  constructor(props: { table: Table; options: string[] }) {
    super();
    this.table = props.table;
    this.options = props.options;
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    const storageParams = this.options.join(", ");
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      `SET (${storageParams})`,
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... RESET ( storage_parameter [, ... ] )
 */
export class AlterTableResetStorageParams extends AlterTableChange {
  public readonly table: Table;
  public readonly params: string[];
  public readonly scope = "object" as const;

  constructor(props: { table: Table; params: string[] }) {
    super();
    this.table = props.table;
    this.params = props.params;
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    const paramsSql = this.params.join(", ");
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      `RESET (${paramsSql})`,
    ].join(" ");
  }
}

// Intentionally no ReplaceTable: destructive changes are not emitted

/**
 * ALTER TABLE ... ADD CONSTRAINT ...
 */
export class AlterTableAddConstraint extends AlterTableChange {
  public readonly table: Table;
  public readonly foreignKeyTable?: Table;
  public readonly constraint: TableConstraintProps;
  public readonly scope = "object" as const;

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

  get creates() {
    return [
      stableId.constraint(
        this.table.schema,
        this.table.name,
        this.constraint.name,
      ),
    ];
  }

  get requires() {
    const reqs = [this.table.stableId];
    if (this.constraint.constraint_type === "f" && this.foreignKeyTable) {
      reqs.push(this.foreignKeyTable.stableId);
    }
    return reqs;
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "ADD CONSTRAINT",
      this.constraint.name,
      this.constraint.definition,
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... DROP CONSTRAINT ...
 */
export class AlterTableDropConstraint extends AlterTableChange {
  public readonly table: Table;
  public readonly constraint: TableConstraintProps;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; constraint: TableConstraintProps }) {
    super();
    this.table = props.table;
    this.constraint = props.constraint;
  }

  get drops() {
    return [
      stableId.constraint(
        this.table.schema,
        this.table.name,
        this.constraint.name,
      ),
    ];
  }

  get requires() {
    return [
      stableId.constraint(
        this.table.schema,
        this.table.name,
        this.constraint.name,
      ),
      this.table.stableId,
    ];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "DROP CONSTRAINT",
      this.constraint.name,
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... VALIDATE CONSTRAINT ...
 */
export class AlterTableValidateConstraint extends AlterTableChange {
  public readonly table: Table;
  public readonly constraint: TableConstraintProps;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; constraint: TableConstraintProps }) {
    super();
    this.table = props.table;
    this.constraint = props.constraint;
  }

  get requires() {
    return [
      stableId.constraint(
        this.table.schema,
        this.table.name,
        this.constraint.name,
      ),
      this.table.stableId,
    ];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "VALIDATE CONSTRAINT",
      this.constraint.name,
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... REPLICA IDENTITY ...
 */
export class AlterTableSetReplicaIdentity extends AlterTableChange {
  public readonly table: Table;
  public readonly mode: "d" | "n" | "f" | "i";
  public readonly scope = "object" as const;

  constructor(props: { table: Table; mode: "d" | "n" | "f" | "i" }) {
    super();
    this.table = props.table;
    this.mode = props.mode;
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    const clause =
      this.mode === "d"
        ? "DEFAULT"
        : this.mode === "n"
          ? "NOTHING"
          : this.mode === "f"
            ? "FULL"
            : "DEFAULT"; // 'i' (USING INDEX) is handled via index changes; fallback to DEFAULT
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "REPLICA IDENTITY",
      clause,
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ADD COLUMN ...
 */
export class AlterTableAddColumn extends AlterTableChange {
  public readonly table: Table;
  public readonly column: ColumnProps;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get creates() {
    return [
      stableId.column(this.table.schema, this.table.name, this.column.name),
    ];
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    const parts: string[] = [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "ADD COLUMN",
      this.column.name,
      this.column.data_type_str,
    ];
    if (this.column.collation) {
      parts.push("COLLATE", this.column.collation);
    }
    if (this.column.is_identity) {
      parts.push(
        this.column.is_identity_always
          ? "GENERATED ALWAYS AS IDENTITY"
          : "GENERATED BY DEFAULT AS IDENTITY",
      );
    } else if (this.column.is_generated && this.column.default !== null) {
      parts.push(`GENERATED ALWAYS AS (${this.column.default}) STORED`);
    } else if (this.column.default !== null) {
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
export class AlterTableDropColumn extends AlterTableChange {
  public readonly table: Table;
  public readonly column: ColumnProps;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get drops() {
    return [
      stableId.column(this.table.schema, this.table.name, this.column.name),
    ];
  }

  get requires() {
    return [
      this.table.stableId,
      stableId.column(this.table.schema, this.table.name, this.column.name),
    ];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "DROP COLUMN",
      this.column.name,
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ALTER COLUMN ... TYPE ...
 */
export class AlterTableAlterColumnType extends AlterTableChange {
  public readonly table: Table;
  public readonly column: ColumnProps;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get requires() {
    return [
      stableId.column(this.table.schema, this.table.name, this.column.name),
    ];
  }

  serialize(): string {
    const parts: string[] = [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "ALTER COLUMN",
      this.column.name,
      "TYPE",
      this.column.data_type_str,
    ];
    if (this.column.collation) {
      parts.push("COLLATE", this.column.collation);
    }
    return parts.join(" ");
  }
}

/**
 * ALTER TABLE ... ALTER COLUMN ... SET DEFAULT ...
 */
export class AlterTableAlterColumnSetDefault extends AlterTableChange {
  public readonly table: Table;
  public readonly column: ColumnProps;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get requires() {
    return [
      stableId.column(this.table.schema, this.table.name, this.column.name),
    ];
  }

  serialize(): string {
    const set = this.column.is_generated ? "SET EXPRESSION AS" : "SET DEFAULT";

    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "ALTER COLUMN",
      this.column.name,
      set,
      this.column.default ?? "NULL",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ALTER COLUMN ... DROP DEFAULT
 */
export class AlterTableAlterColumnDropDefault extends AlterTableChange {
  public readonly table: Table;
  public readonly column: ColumnProps;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get requires() {
    return [
      stableId.column(this.table.schema, this.table.name, this.column.name),
    ];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "ALTER COLUMN",
      this.column.name,
      "DROP DEFAULT",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ALTER COLUMN ... SET NOT NULL
 */
export class AlterTableAlterColumnSetNotNull extends AlterTableChange {
  public readonly table: Table;
  public readonly column: ColumnProps;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get requires() {
    return [
      stableId.column(this.table.schema, this.table.name, this.column.name),
    ];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "ALTER COLUMN",
      this.column.name,
      "SET NOT NULL",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL
 */
export class AlterTableAlterColumnDropNotNull extends AlterTableChange {
  public readonly table: Table;
  public readonly column: ColumnProps;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get requires() {
    return [
      stableId.column(this.table.schema, this.table.name, this.column.name),
    ];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "ALTER COLUMN",
      this.column.name,
      "DROP NOT NULL",
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... ATTACH PARTITION ...
 */
export class AlterTableAttachPartition extends AlterTableChange {
  public readonly table: Table;
  public readonly partition: Table;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; partition: Table }) {
    super();
    this.table = props.table;
    this.partition = props.partition;
  }

  get requires() {
    // Depend on the partition child so that it is created before attach
    return [this.partition.stableId, this.table.stableId];
  }

  serialize(): string {
    const bound = this.partition.partition_bound ?? "DEFAULT";
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "ATTACH PARTITION",
      `${this.partition.schema}.${this.partition.name}`,
      bound,
    ].join(" ");
  }
}

/**
 * ALTER TABLE ... DETACH PARTITION ...
 */
export class AlterTableDetachPartition extends AlterTableChange {
  public readonly table: Table;
  public readonly partition: Table;
  public readonly scope = "object" as const;

  constructor(props: { table: Table; partition: Table }) {
    super();
    this.table = props.table;
    this.partition = props.partition;
  }

  get requires() {
    // Depend on the partition child for consistent ordering with potential drops
    return [this.table.stableId, this.partition.stableId];
  }

  serialize(): string {
    return [
      "ALTER TABLE",
      `${this.table.schema}.${this.table.name}`,
      "DETACH PARTITION",
      `${this.partition.schema}.${this.partition.name}`,
    ].join(" ");
  }
}
