import { quoteLiteral } from "../../base.change.ts";
import type { Collation } from "../collation.model.ts";
import {
  CreateCollationChange,
  DropCollationChange,
} from "./collation.base.ts";

export type CommentCollation =
  | CreateCommentOnCollation
  | DropCommentOnCollation;

/**
 * Create/drop comments on collations.
 */
export class CreateCommentOnCollation extends CreateCollationChange {
  public readonly collation: Collation;
  public readonly scope = "comment" as const;

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

export class DropCommentOnCollation extends DropCollationChange {
  public readonly collation: Collation;
  public readonly scope = "comment" as const;

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
