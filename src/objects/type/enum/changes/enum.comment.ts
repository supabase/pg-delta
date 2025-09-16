import {
  CreateChange,
  DropChange,
  quoteLiteral,
} from "../../../base.change.ts";
import type { Enum } from "../enum.model.ts";

/**
 * Create/drop comments on enum types.
 */
export class CreateCommentOnEnum extends CreateChange {
  public readonly enum: Enum;

  constructor(props: { enum: Enum }) {
    super();
    this.enum = props.enum;
  }

  get dependencies() {
    return [`comment:${this.enum.schema}.${this.enum.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.enum.schema}.${this.enum.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: enum comment is not nullable in this case
      quoteLiteral(this.enum.comment!),
    ].join(" ");
  }
}

export class DropCommentOnEnum extends DropChange {
  public readonly enum: Enum;

  constructor(props: { enum: Enum }) {
    super();
    this.enum = props.enum;
  }

  get dependencies() {
    return [`comment:${this.enum.schema}.${this.enum.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.enum.schema}.${this.enum.name}`,
      "IS NULL",
    ].join(" ");
  }
}
