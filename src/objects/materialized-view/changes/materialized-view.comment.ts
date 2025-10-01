import { Change, quoteLiteral } from "../../base.change.ts";
import type { ColumnProps } from "../../base.model.ts";
import type { MaterializedView } from "../materialized-view.model.ts";

/**
 * Create/drop comments on materialized view columns.
 *
 * @see https://www.postgresql.org/docs/17/sql-comment.html
 */

export class CreateCommentOnMaterializedView extends Change {
  public readonly materializedView: MaterializedView;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "materialized_view" as const;

  constructor(props: { materializedView: MaterializedView }) {
    super();
    this.materializedView = props.materializedView;
  }

  get dependencies() {
    return [
      `comment:${this.materializedView.schema}.${this.materializedView.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON MATERIALIZED VIEW",
      `${this.materializedView.schema}.${this.materializedView.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: mv comment is not nullable in this case
      quoteLiteral(this.materializedView.comment!),
    ].join(" ");
  }
}

export class DropCommentOnMaterializedView extends Change {
  public readonly materializedView: MaterializedView;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "materialized_view" as const;

  constructor(props: { materializedView: MaterializedView }) {
    super();
    this.materializedView = props.materializedView;
  }

  get dependencies() {
    return [
      `comment:${this.materializedView.schema}.${this.materializedView.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON MATERIALIZED VIEW",
      `${this.materializedView.schema}.${this.materializedView.name}`,
      "IS NULL",
    ].join(" ");
  }
}

export class CreateCommentOnMaterializedViewColumn extends Change {
  public readonly materializedView: MaterializedView;
  public readonly column: ColumnProps;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "materialized_view" as const;

  constructor(props: {
    materializedView: MaterializedView;
    column: ColumnProps;
  }) {
    super();
    this.materializedView = props.materializedView;
    this.column = props.column;
  }

  get dependencies() {
    return [
      `comment:${this.materializedView.schema}.${this.materializedView.name}.${this.column.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON COLUMN",
      `${this.materializedView.schema}.${this.materializedView.name}.${this.column.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: column comment is not nullable in this case
      quoteLiteral(this.column.comment!),
    ].join(" ");
  }
}

export class DropCommentOnMaterializedViewColumn extends Change {
  public readonly materializedView: MaterializedView;
  public readonly column: ColumnProps;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "materialized_view" as const;

  constructor(props: {
    materializedView: MaterializedView;
    column: ColumnProps;
  }) {
    super();
    this.materializedView = props.materializedView;
    this.column = props.column;
  }

  get dependencies() {
    return [
      `comment:${this.materializedView.schema}.${this.materializedView.name}.${this.column.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON COLUMN",
      `${this.materializedView.schema}.${this.materializedView.name}.${this.column.name}`,
      "IS NULL",
    ].join(" ");
  }
}
