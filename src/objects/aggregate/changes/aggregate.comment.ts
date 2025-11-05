import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Aggregate } from "../aggregate.model.ts";
import {
  CreateAggregateChange,
  DropAggregateChange,
} from "./aggregate.base.ts";

export type CommentAggregate =
  | CreateCommentOnAggregate
  | DropCommentOnAggregate;

export class CreateCommentOnAggregate extends CreateAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly scope = "comment" as const;

  constructor(props: { aggregate: Aggregate }) {
    super();
    this.aggregate = props.aggregate;
  }

  get creates() {
    return [stableId.comment(this.aggregate.stableId)];
  }

  get requires() {
    return [this.aggregate.stableId];
  }

  serialize(): string {
    const signature = this.aggregate.identityArguments;
    const qualifiedName = `${this.aggregate.schema}.${this.aggregate.name}`;
    const withArgs = signature.length > 0 ? `(${signature})` : "()";
    // biome-ignore lint/style/noNonNullAssertion: aggregate comment is non-null in this branch
    return `COMMENT ON AGGREGATE ${qualifiedName}${withArgs} IS ${quoteLiteral(this.aggregate.comment!)}`;
  }
}

export class DropCommentOnAggregate extends DropAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly scope = "comment" as const;

  constructor(props: { aggregate: Aggregate }) {
    super();
    this.aggregate = props.aggregate;
  }

  get drops() {
    return [stableId.comment(this.aggregate.stableId)];
  }

  get requires() {
    return [stableId.comment(this.aggregate.stableId), this.aggregate.stableId];
  }

  serialize(): string {
    const signature = this.aggregate.identityArguments;
    const qualifiedName = `${this.aggregate.schema}.${this.aggregate.name}`;
    const withArgs = signature.length > 0 ? `(${signature})` : "()";
    return `COMMENT ON AGGREGATE ${qualifiedName}${withArgs} IS NULL`;
  }
}
