import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Subscription } from "../subscription.model.ts";
import {
  CreateSubscriptionChange,
  DropSubscriptionChange,
} from "./subscription.base.ts";

export type CommentSubscription =
  | CreateCommentOnSubscription
  | DropCommentOnSubscription;

export class CreateCommentOnSubscription extends CreateSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "comment" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  get creates() {
    return [stableId.comment(this.subscription.stableId)];
  }

  get requires() {
    return [this.subscription.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON SUBSCRIPTION",
      this.subscription.name,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: ensures comment provided by caller
      quoteLiteral(this.subscription.comment!),
    ].join(" ");
  }
}

export class DropCommentOnSubscription extends DropSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "comment" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  get drops() {
    return [stableId.comment(this.subscription.stableId)];
  }

  get requires() {
    return [
      stableId.comment(this.subscription.stableId),
      this.subscription.stableId,
    ];
  }

  serialize(): string {
    return `COMMENT ON SUBSCRIPTION ${this.subscription.name} IS NULL`;
  }
}
