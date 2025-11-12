import { quoteLiteral } from "../../base.change.ts";
import type { ColumnProps } from "../../base.model.ts";
import { stableId } from "../../utils.ts";
import type { Table, TableConstraintProps } from "../table.model.ts";
import { CreateTableChange, DropTableChange } from "./table.base.ts";

/**
 * Create a table/column/constraint comment.
 *
 * @see https://www.postgresql.org/docs/17/sql-comment.html
 *
 * Synopsis
 * ```sql
 * COMMENT ON
 * {
 *   COLUMN relation_name.column_name |
 *   CONSTRAINT constraint_name ON table_name |
 *   TABLE object_name
 * } IS { string_literal | NULL }
 *
 * ```
 */

export type CommentTable =
  | CreateCommentOnColumn
  | CreateCommentOnConstraint
  | CreateCommentOnTable
  | DropCommentOnColumn
  | DropCommentOnConstraint
  | DropCommentOnTable;

/**
 * COMMENT ON TABLE ... IS ...
 */
export class CreateCommentOnTable extends CreateTableChange {
  public readonly table: Table;
  public readonly scope = "comment" as const;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get creates() {
    return [stableId.comment(this.table.stableId)];
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON TABLE",
      `${this.table.schema}.${this.table.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: table comment is not nullable in this case
      quoteLiteral(this.table.comment!),
    ].join(" ");
  }
}

/**
 * COMMENT ON TABLE ... IS ...
 */
export class DropCommentOnTable extends DropTableChange {
  public readonly table: Table;
  public readonly scope = "comment" as const;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get drops() {
    return [stableId.comment(this.table.stableId)];
  }

  get requires() {
    return [stableId.comment(this.table.stableId), this.table.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON TABLE",
      `${this.table.schema}.${this.table.name}`,
      "IS NULL",
    ].join(" ");
  }
}

/**
 * COMMENT ON COLUMN ... IS ...
 */
export class CreateCommentOnColumn extends CreateTableChange {
  public readonly table: Table;
  public readonly column: ColumnProps;
  public readonly scope = "comment" as const;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get creates() {
    const columnStableId = stableId.column(
      this.table.schema,
      this.table.name,
      this.column.name,
    );
    return [stableId.comment(columnStableId)];
  }

  get requires() {
    return [
      stableId.column(this.table.schema, this.table.name, this.column.name),
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON COLUMN",
      `${this.table.schema}.${this.table.name}.${this.column.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: column comment is not nullable in this case
      quoteLiteral(this.column.comment!),
    ].join(" ");
  }
}

/**
 * COMMENT ON COLUMN ... IS ...
 */
export class DropCommentOnColumn extends DropTableChange {
  public readonly table: Table;
  public readonly column: ColumnProps;
  public readonly scope = "comment" as const;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get drops() {
    const columnStableId = stableId.column(
      this.table.schema,
      this.table.name,
      this.column.name,
    );
    return [stableId.comment(columnStableId)];
  }

  get requires() {
    const columnStableId = stableId.column(
      this.table.schema,
      this.table.name,
      this.column.name,
    );
    return [stableId.comment(columnStableId), columnStableId];
  }

  serialize(): string {
    return [
      "COMMENT ON COLUMN",
      `${this.table.schema}.${this.table.name}.${this.column.name}`,
      "IS NULL",
    ].join(" ");
  }
}

/**
 * COMMENT ON CONSTRAINT ... IS ...
 */
export class CreateCommentOnConstraint extends CreateTableChange {
  public readonly table: Table;
  public readonly constraint: TableConstraintProps;
  public readonly scope = "comment" as const;

  constructor(props: {
    table: Table;
    constraint: TableConstraintProps;
  }) {
    super();
    this.table = props.table;
    this.constraint = props.constraint;
  }

  get creates() {
    const constraintStableId = stableId.constraint(
      this.table.schema,
      this.table.name,
      this.constraint.name,
    );
    return [stableId.comment(constraintStableId)];
  }

  get requires() {
    return [
      stableId.constraint(
        this.table.schema,
        this.table.name,
        this.constraint.name,
      ),
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON CONSTRAINT",
      this.constraint.name,
      "ON",
      `${this.table.schema}.${this.table.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: constraint comment is not nullable in this case
      quoteLiteral(this.constraint.comment!),
    ].join(" ");
  }
}

/**
 * COMMENT ON CONSTRAINT ... IS ...
 */
export class DropCommentOnConstraint extends DropTableChange {
  public readonly table: Table;
  public readonly constraint: TableConstraintProps;
  public readonly scope = "comment" as const;

  constructor(props: {
    table: Table;
    constraint: TableConstraintProps;
  }) {
    super();
    this.table = props.table;
    this.constraint = props.constraint;
  }

  get drops() {
    const constraintStableId = stableId.constraint(
      this.table.schema,
      this.table.name,
      this.constraint.name,
    );
    return [stableId.comment(constraintStableId)];
  }

  get requires() {
    const constraintStableId = stableId.constraint(
      this.table.schema,
      this.table.name,
      this.constraint.name,
    );
    return [stableId.comment(constraintStableId), constraintStableId];
  }

  serialize(): string {
    return [
      "COMMENT ON CONSTRAINT",
      this.constraint.name,
      "ON",
      `${this.table.schema}.${this.table.name}`,
      "IS NULL",
    ].join(" ");
  }
}
