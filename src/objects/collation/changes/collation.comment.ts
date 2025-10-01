import { Change, quoteLiteral } from "../../base.change.ts";
import type { Collation } from "../collation.model.ts";

/**
 * Create/drop comments on collations.
 */
export class CreateCommentOnCollation extends Change {
  public readonly collation: Collation;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "collation" as const;

  constructor(props: { collation: Collation }) {
    super();
    this.collation = props.collation;
  }

  get dependencies() {
    return [`comment:${this.collation.schema}.${this.collation.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON COLLATION",
      `${this.collation.schema}.${this.collation.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: collation comment is not nullable in this case
      quoteLiteral(this.collation.comment!),
    ].join(" ");
  }
}

export class DropCommentOnCollation extends Change {
  public readonly collation: Collation;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "collation" as const;

  constructor(props: { collation: Collation }) {
    super();
    this.collation = props.collation;
  }

  get dependencies() {
    return [`comment:${this.collation.schema}.${this.collation.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON COLLATION",
      `${this.collation.schema}.${this.collation.name}`,
      "IS NULL",
    ].join(" ");
  }
}
