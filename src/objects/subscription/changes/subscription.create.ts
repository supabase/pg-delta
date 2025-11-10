// src/objects/subscription/changes/subscription.create.ts
import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Subscription } from "../subscription.model.ts";
import { formatSubscriptionWithClause } from "../utils.ts";
import { CreateSubscriptionChange } from "./subscription.base.ts";

export class CreateSubscription extends CreateSubscriptionChange {
  readonly subscription: Subscription;
  readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  get creates() {
    return [this.subscription.stableId];
  }

  get requires() {
    return [stableId.role(this.subscription.owner)];
  }

  serialize(): string {
    const parts: string[] = [
      "CREATE SUBSCRIPTION",
      this.subscription.name,
      "CONNECTION",
      quoteLiteral(this.subscription.conninfo),
      "PUBLICATION",
      this.subscription.publications.join(", "),
    ];

    const withOptions = formatSubscriptionWithClause(this.subscription, {
      includeTwoPhase: true,
    });
    if (withOptions.length > 0) {
      parts.push("WITH", `(${withOptions.join(", ")})`);
    }

    return parts.join(" ");
  }
}
