import { describe, expect, test } from "vitest";
import { stableId } from "../../utils.ts";
import { Subscription } from "../subscription.model.ts";
import {
  AlterSubscriptionDisable,
  AlterSubscriptionEnable,
  AlterSubscriptionSetConnection,
  AlterSubscriptionSetOptions,
  AlterSubscriptionSetOwner,
  AlterSubscriptionSetPublication,
} from "./subscription.alter.ts";

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

describe("subscription.alter", () => {
  test("set connection serializes conninfo literal", () => {
    const subscription = makeSubscription({
      conninfo: "dbname=postgres host=replica",
    });
    const change = new AlterSubscriptionSetConnection({ subscription });

    expect(change.serialize()).toBe(
      "ALTER SUBSCRIPTION sub_base CONNECTION 'dbname=postgres host=replica'",
    );
  });

  test("set publication preserves ordering and refresh hint when disabled", () => {
    const enabledSubscription = makeSubscription({
      publications: ["pub_a", "pub_b"],
      enabled: true,
    });
    const enabledChange = new AlterSubscriptionSetPublication({
      subscription: enabledSubscription,
    });

    expect(enabledChange.serialize()).toBe(
      "ALTER SUBSCRIPTION sub_base SET PUBLICATION pub_a, pub_b",
    );

    const disabledSubscription = makeSubscription({
      publications: ["pub_b", "pub_a"],
      enabled: false,
    });
    const disabledChange = new AlterSubscriptionSetPublication({
      subscription: disabledSubscription,
    });

    expect(disabledChange.serialize()).toBe(
      "ALTER SUBSCRIPTION sub_base SET PUBLICATION pub_a, pub_b WITH (refresh = false)",
    );
  });

  test("toggle enablement serializes ENABLE and DISABLE statements", () => {
    const subscription = makeSubscription();

    expect(new AlterSubscriptionEnable({ subscription }).serialize()).toBe(
      "ALTER SUBSCRIPTION sub_base ENABLE",
    );
    expect(new AlterSubscriptionDisable({ subscription }).serialize()).toBe(
      "ALTER SUBSCRIPTION sub_base DISABLE",
    );
  });

  test("set options delegates to option formatter", () => {
    const subscription = makeSubscription({
      slot_name: "custom_slot",
      slot_is_none: false,
      disable_on_error: true,
      origin: "none",
    });
    const change = new AlterSubscriptionSetOptions({
      subscription,
      options: ["slot_name", "disable_on_error", "origin"],
    });

    expect(change.serialize()).toBe(
      "ALTER SUBSCRIPTION sub_base SET (slot_name = 'custom_slot', disable_on_error = true, origin = 'none')",
    );
  });

  test("set owner tracks role dependency", () => {
    const subscription = makeSubscription();
    const change = new AlterSubscriptionSetOwner({
      subscription,
      owner: "new_owner",
    });

    expect(change.requires).toEqual([stableId.role("new_owner")]);
    expect(change.serialize()).toBe(
      "ALTER SUBSCRIPTION sub_base OWNER TO new_owner",
    );
  });
});
