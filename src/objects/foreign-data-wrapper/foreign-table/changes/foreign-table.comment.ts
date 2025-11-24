import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignTable } from "../foreign-table.model.ts";
import {
  CreateForeignTableChange,
  DropForeignTableChange,
} from "./foreign-table.base.ts";

/**
 * Create/drop comments on foreign tables.
 */

export type CommentForeignTable =
  | CreateCommentOnForeignTable
  | DropCommentOnForeignTable;

export class CreateCommentOnForeignTable extends CreateForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly scope = "comment" as const;

  constructor(props: { foreignTable: ForeignTable }) {
    super();
    this.foreignTable = props.foreignTable;
  }

  get creates() {
    return [stableId.comment(this.foreignTable.stableId)];
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON FOREIGN TABLE",
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: comment is not nullable in this case
      quoteLiteral(this.foreignTable.comment!),
    ].join(" ");
  }
}

export class DropCommentOnForeignTable extends DropForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly scope = "comment" as const;

  constructor(props: { foreignTable: ForeignTable }) {
    super();
    this.foreignTable = props.foreignTable;
  }

  get drops() {
    return [stableId.comment(this.foreignTable.stableId)];
  }

  get requires() {
    return [
      stableId.comment(this.foreignTable.stableId),
      this.foreignTable.stableId,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON FOREIGN TABLE",
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      "IS NULL",
    ].join(" ");
  }
}
