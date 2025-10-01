import { Change, quoteLiteral } from "../../../base.change.ts";
import type { Enum } from "../enum.model.ts";

/**
 * Create/drop comments on enum types.
 */
export class CreateCommentOnEnum extends Change {
  public readonly enum: Enum;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "enum" as const;

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

export class DropCommentOnEnum extends Change {
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "enum" as const;
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
