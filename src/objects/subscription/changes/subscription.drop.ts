import type { Subscription } from "../subscription.model.ts";
import { DropSubscriptionChange } from "./subscription.base.ts";

export class DropSubscription extends DropSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  get drops() {
    return [this.subscription.stableId];
  }

  serialize(): string {
    return `DROP SUBSCRIPTION ${this.subscription.name}`;
  }
}
