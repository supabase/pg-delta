// src/objects/subscription/changes/subscription.create.ts
import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Subscription } from "../subscription.model.ts";
import { collectSubscriptionOptions } from "../utils.ts";
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

    const optionEntries = collectSubscriptionOptions(this.subscription, {
      includeTwoPhase: true,
      includeEnabled: true,
    });
    const optionsMap = new Map(
      optionEntries.map(({ key, value }) => [key, value]),
    );

    if (!this.subscription.replication_slot_created) {
      optionsMap.set("create_slot", "false");
      optionsMap.set("connect", "false");

      const defaultSlotName = this.subscription.raw_name;
      const slotName = this.subscription.slot_name ?? defaultSlotName;
      const shouldUseNone =
        this.subscription.slot_is_none || slotName === defaultSlotName;

      if (shouldUseNone) {
        optionsMap.set("slot_name", "NONE");
      } else {
        optionsMap.set("slot_name", quoteLiteral(slotName));
      }
    }

    const withOptions = Array.from(optionsMap.entries()).map(
      ([key, value]) => `${key} = ${value}`,
    );

    if (withOptions.length > 0) {
      parts.push("WITH", `(${withOptions.join(", ")})`);
    }

    return parts.join(" ");
  }
}
