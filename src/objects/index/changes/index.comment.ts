import { Change, quoteLiteral } from "../../base.change.ts";
import type { Index } from "../index.model.ts";

/**
 * Create/drop comments on indexes.
 */
export class CreateCommentOnIndex extends Change {
  public readonly index: Index;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "index" as const;

  constructor(props: { index: Index }) {
    super();
    this.index = props.index;
  }

  get dependencies() {
    return [
      `comment:${this.index.schema}.${this.index.table_name}.${this.index.name}`,
    ];
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

export class DropCommentOnIndex extends Change {
  public readonly index: Index;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "index" as const;

  constructor(props: { index: Index }) {
    super();
    this.index = props.index;
  }

  get dependencies() {
    return [
      `comment:${this.index.schema}.${this.index.table_name}.${this.index.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON INDEX",
      `${this.index.schema}.${this.index.name}`,
      "IS NULL",
    ].join(" ");
  }
}
