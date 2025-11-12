import { describe, expect, test } from "vitest";
import { Subscription } from "../subscription.model.ts";
import { DropSubscription } from "./subscription.drop.ts";

type SubscriptionProps = ConstructorParameters<typeof Subscription>[0];

const base: SubscriptionProps = {
  name: "sub_base",
  raw_name: "sub_base",
  owner: "owner1",
  comment: null,
  enabled: true,
  binary: false,
  streaming: "off",
  two_phase: false,
  disable_on_error: false,
  password_required: true,
  run_as_owner: false,
  failover: false,
  conninfo: "host=example dbname=postgres",
  slot_name: null,
  slot_is_none: false,
  replication_slot_created: true,
  synchronous_commit: "off",
  publications: ["pub_base"],
  origin: "any",
};

const makeSubscription = (override: Partial<SubscriptionProps> = {}) =>
  new Subscription({
    ...base,
    ...override,
    publications: override.publications
      ? [...override.publications]
      : [...base.publications],
  });

describe("subscription.drop", () => {
  test("serialize drop subscription", () => {
    const subscription = makeSubscription();
    const change = new DropSubscription({ subscription });

    expect(change.drops).toEqual([subscription.stableId]);
    expect(change.serialize()).toBe("DROP SUBSCRIPTION sub_base");
  });
});
