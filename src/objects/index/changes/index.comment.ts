import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Index } from "../index.model.ts";
import { CreateIndexChange, DropIndexChange } from "./index.base.ts";

export type CommentIndex = CreateCommentOnIndex | DropCommentOnIndex;

/**
 * Create/drop comments on indexes.
 */
export class CreateCommentOnIndex extends CreateIndexChange {
  public readonly index: Index;
  public readonly scope = "comment" as const;

  constructor(props: { index: Index }) {
    super();
    this.index = props.index;
  }

  get creates() {
    return [stableId.comment(this.index.stableId)];
  }

  get requires() {
    return [this.index.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON INDEX",
      `${this.index.schema}.${this.index.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: index comment is not nullable here
      quoteLiteral(this.index.comment!),
    ].join(" ");
  }
}

export class DropCommentOnIndex extends DropIndexChange {
  public readonly index: Index;
  public readonly scope = "comment" as const;

  constructor(props: { index: Index }) {
    super();
    this.index = props.index;
  }

  get drops() {
    return [stableId.comment(this.index.stableId)];
  }

  get requires() {
    return [stableId.comment(this.index.stableId), this.index.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON INDEX",
      `${this.index.schema}.${this.index.name}`,
      "IS NULL",
    ].join(" ");
  }
}
