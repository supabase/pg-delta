import { describe, expect, test } from "vitest";
import { stableId } from "../../utils.ts";
import { Subscription } from "../subscription.model.ts";
import { CreateSubscription } from "./subscription.create.ts";

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

describe("subscription.create", () => {
  test("serialize minimal subscription", () => {
    const subscription = makeSubscription();
    const change = new CreateSubscription({ subscription });

    expect(change.creates).toEqual([subscription.stableId]);
    expect(change.requires).toEqual([stableId.role(subscription.owner)]);
    expect(change.serialize()).toBe(
      "CREATE SUBSCRIPTION sub_base CONNECTION 'host=example dbname=postgres' PUBLICATION pub_base",
    );
  });

  test("serialize subscription with extended options", () => {
    const subscription = makeSubscription({
      enabled: false,
      binary: true,
      streaming: "parallel",
      two_phase: true,
      disable_on_error: true,
      password_required: false,
      run_as_owner: true,
      failover: true,
      conninfo: "dbname=postgres application_name=sub_base",
      slot_name: "custom_slot",
      slot_is_none: false,
      replication_slot_created: false,
      synchronous_commit: "local",
      publications: ["pub_b", "pub_a"],
      origin: "none",
    });

    const change = new CreateSubscription({ subscription });

    expect(change.requires).toEqual([stableId.role(subscription.owner)]);
    expect(change.serialize()).toBe(
      "CREATE SUBSCRIPTION sub_base CONNECTION 'dbname=postgres application_name=sub_base' PUBLICATION pub_a, pub_b WITH (enabled = false, slot_name = 'custom_slot', binary = true, streaming = 'parallel', synchronous_commit = 'local', two_phase = true, disable_on_error = true, password_required = false, run_as_owner = true, origin = 'none', failover = true, create_slot = false, connect = false)",
    );
  });
});
