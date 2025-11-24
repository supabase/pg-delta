import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignDataWrapper } from "../foreign-data-wrapper.model.ts";
import {
  CreateForeignDataWrapperChange,
  DropForeignDataWrapperChange,
} from "./foreign-data-wrapper.base.ts";

/**
 * Create/drop comments on foreign data wrappers.
 */

export type CommentForeignDataWrapper =
  | CreateCommentOnForeignDataWrapper
  | DropCommentOnForeignDataWrapper;

export class CreateCommentOnForeignDataWrapper extends CreateForeignDataWrapperChange {
  public readonly foreignDataWrapper: ForeignDataWrapper;
  public readonly scope = "comment" as const;

  constructor(props: { foreignDataWrapper: ForeignDataWrapper }) {
    super();
    this.foreignDataWrapper = props.foreignDataWrapper;
  }

  get creates() {
    return [stableId.comment(this.foreignDataWrapper.stableId)];
  }

  get requires() {
    return [this.foreignDataWrapper.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON FOREIGN DATA WRAPPER",
      this.foreignDataWrapper.name,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: comment is not nullable in this case
      quoteLiteral(this.foreignDataWrapper.comment!),
    ].join(" ");
  }
}

export class DropCommentOnForeignDataWrapper extends DropForeignDataWrapperChange {
  public readonly foreignDataWrapper: ForeignDataWrapper;
  public readonly scope = "comment" as const;

  constructor(props: { foreignDataWrapper: ForeignDataWrapper }) {
    super();
    this.foreignDataWrapper = props.foreignDataWrapper;
  }

  get drops() {
    return [stableId.comment(this.foreignDataWrapper.stableId)];
  }

  get requires() {
    return [
      stableId.comment(this.foreignDataWrapper.stableId),
      this.foreignDataWrapper.stableId,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON FOREIGN DATA WRAPPER",
      this.foreignDataWrapper.name,
      "IS NULL",
    ].join(" ");
  }
}
