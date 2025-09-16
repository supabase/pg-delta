import {
  CreateChange,
  DropChange,
  quoteLiteral,
} from "../../../base.change.ts";
import type { Range } from "../range.model.ts";

/**
 * Create/drop comments on range types.
 */
export class CreateCommentOnRange extends CreateChange {
  public readonly range: Range;

  constructor(props: { range: Range }) {
    super();
    this.range = props.range;
  }

  get dependencies() {
    return [`comment:${this.range.schema}.${this.range.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.range.schema}.${this.range.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: range comment is not nullable in this case
      quoteLiteral(this.range.comment!),
    ].join(" ");
  }
}

export class DropCommentOnRange extends DropChange {
  public readonly range: Range;

  constructor(props: { range: Range }) {
    super();
    this.range = props.range;
  }

  get dependencies() {
    return [`comment:${this.range.schema}.${this.range.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.range.schema}.${this.range.name}`,
      "IS NULL",
    ].join(" ");
  }
}
