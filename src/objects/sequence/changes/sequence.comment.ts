import { Change, quoteLiteral } from "../../base.change.ts";
import type { Sequence } from "../sequence.model.ts";

export class CreateCommentOnSequence extends Change {
  public readonly sequence: Sequence;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "sequence" as const;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get dependencies() {
    return [`comment:${this.sequence.schema}.${this.sequence.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: sequence comment is not nullable in this case
      quoteLiteral(this.sequence.comment!),
    ].join(" ");
  }
}

export class DropCommentOnSequence extends Change {
  public readonly sequence: Sequence;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "sequence" as const;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get dependencies() {
    return [`comment:${this.sequence.schema}.${this.sequence.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
      "IS NULL",
    ].join(" ");
  }
}
