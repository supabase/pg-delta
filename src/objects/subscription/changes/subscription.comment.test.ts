import { describe, expect, test } from "vitest";
import { stableId } from "../../utils.ts";
import { Subscription } from "../subscription.model.ts";
import {
  CreateCommentOnSubscription,
  DropCommentOnSubscription,
} from "./subscription.comment.ts";

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

describe("subscription.comment", () => {
  test("create comment serializes and declares dependencies", () => {
    const subscription = makeSubscription({
      comment: "subscription's metadata",
    });
    const change = new CreateCommentOnSubscription({ subscription });

    expect(change.creates).toEqual([stableId.comment(subscription.stableId)]);
    expect(change.requires).toEqual([subscription.stableId]);
    expect(change.serialize()).toBe(
      "COMMENT ON SUBSCRIPTION sub_base IS 'subscription''s metadata'",
    );
  });

  test("drop comment serializes and tracks drops", () => {
    const subscription = makeSubscription({ comment: "not used" });
    const change = new DropCommentOnSubscription({ subscription });

    expect(change.drops).toEqual([stableId.comment(subscription.stableId)]);
    expect(change.requires).toEqual([
      stableId.comment(subscription.stableId),
      subscription.stableId,
    ]);
    expect(change.serialize()).toBe("COMMENT ON SUBSCRIPTION sub_base IS NULL");
  });
});
