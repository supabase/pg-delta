import { describe, expect, test } from "vitest";
import {
  AlterSubscriptionDisable,
  AlterSubscriptionEnable,
  AlterSubscriptionSetConnection,
  AlterSubscriptionSetOptions,
  AlterSubscriptionSetOwner,
  AlterSubscriptionSetPublication,
} from "./changes/subscription.alter.ts";
import {
  CreateCommentOnSubscription,
  DropCommentOnSubscription,
} from "./changes/subscription.comment.ts";
import { CreateSubscription } from "./changes/subscription.create.ts";
import { DropSubscription } from "./changes/subscription.drop.ts";
import { diffSubscriptions } from "./subscription.diff.ts";
import { Subscription, type SubscriptionProps } from "./subscription.model.ts";

const baseProps: SubscriptionProps = {
  name: "mysub",
  raw_name: "mysub",
  owner: "postgres",
  comment: null,
  enabled: true,
  binary: false,
  streaming: "off",
  two_phase: false,
  disable_on_error: false,
  password_required: true,
  run_as_owner: false,
  failover: false,
  conninfo: "host=localhost port=5432 dbname=postgres",
  slot_name: null,
  slot_is_none: false,
  synchronous_commit: "off",
  publications: ["pub_a"],
  origin: "any",
};

describe.concurrent("subscription.diff", () => {
  test("create and drop subscription", () => {
    const subscription = new Subscription(baseProps);
    const created = diffSubscriptions(
      {},
      { [subscription.stableId]: subscription },
    );
    expect(created.some((change) => change instanceof CreateSubscription)).toBe(
      true,
    );

    const dropped = diffSubscriptions(
      { [subscription.stableId]: subscription },
      {},
    );
    expect(dropped.some((change) => change instanceof DropSubscription)).toBe(
      true,
    );
  });

  test("detect connection string change", () => {
    const mainSubscription = new Subscription(baseProps);
    const branchSubscription = new Subscription({
      ...baseProps,
      conninfo: "host=replica port=5433 dbname=postgres",
    });
    const changes = diffSubscriptions(
      { [mainSubscription.stableId]: mainSubscription },
      { [branchSubscription.stableId]: branchSubscription },
    );
    expect(
      changes.some(
        (change) => change instanceof AlterSubscriptionSetConnection,
      ),
    ).toBe(true);
  });

  test("detect publication list change", () => {
    const mainSubscription = new Subscription(baseProps);
    const branchSubscription = new Subscription({
      ...baseProps,
      publications: ["pub_a", "pub_b"],
    });
    const changes = diffSubscriptions(
      { [mainSubscription.stableId]: mainSubscription },
      { [branchSubscription.stableId]: branchSubscription },
    );
    expect(
      changes.some(
        (change) => change instanceof AlterSubscriptionSetPublication,
      ),
    ).toBe(true);
  });

  test("detect enabled toggle", () => {
    const mainSubscription = new Subscription(baseProps);
    const branchDisabled = new Subscription({
      ...baseProps,
      enabled: false,
    });
    const disableChanges = diffSubscriptions(
      { [mainSubscription.stableId]: mainSubscription },
      { [branchDisabled.stableId]: branchDisabled },
    );
    expect(
      disableChanges.some(
        (change) => change instanceof AlterSubscriptionDisable,
      ),
    ).toBe(true);

    const enableChanges = diffSubscriptions(
      { [branchDisabled.stableId]: branchDisabled },
      { [mainSubscription.stableId]: mainSubscription },
    );
    expect(
      enableChanges.some((change) => change instanceof AlterSubscriptionEnable),
    ).toBe(true);
  });

  test("detect option changes including slot name overrides", () => {
    const mainSubscription = new Subscription(baseProps);
    const branchSubscription = new Subscription({
      ...baseProps,
      binary: true,
      streaming: "parallel",
      synchronous_commit: "local",
      disable_on_error: true,
      password_required: false,
      run_as_owner: true,
      origin: "none",
      failover: true,
      slot_name: "custom_slot",
      slot_is_none: false,
    });
    const changes = diffSubscriptions(
      { [mainSubscription.stableId]: mainSubscription },
      { [branchSubscription.stableId]: branchSubscription },
    );
    const setOptionsChange = changes.find(
      (change) => change instanceof AlterSubscriptionSetOptions,
    ) as AlterSubscriptionSetOptions | undefined;
    expect(setOptionsChange).toBeDefined();
    expect(setOptionsChange?.serialize()).toBe(
      "ALTER SUBSCRIPTION mysub SET (slot_name = 'custom_slot', binary = true, streaming = 'parallel', synchronous_commit = 'local', disable_on_error = true, password_required = false, run_as_owner = true, origin = 'none', failover = true)",
    );
  });

  test("set slot name to NONE when branch subscription uses slotless configuration", () => {
    const mainSubscription = new Subscription(baseProps);
    const branchSubscription = new Subscription({
      ...baseProps,
      slot_name: null,
      slot_is_none: true,
    });
    const changes = diffSubscriptions(
      { [mainSubscription.stableId]: mainSubscription },
      { [branchSubscription.stableId]: branchSubscription },
    );
    const setOptionsChange = changes.find(
      (change) => change instanceof AlterSubscriptionSetOptions,
    ) as AlterSubscriptionSetOptions | undefined;
    expect(setOptionsChange).toBeDefined();
    expect(setOptionsChange?.serialize()).toBe(
      "ALTER SUBSCRIPTION mysub SET (slot_name = NONE)",
    );
  });

  test("owner and comment changes", () => {
    const mainSubscription = new Subscription(baseProps);
    const branchSubscription = new Subscription({
      ...baseProps,
      owner: "other_role",
      comment: "replication subscription",
    });
    const changes = diffSubscriptions(
      { [mainSubscription.stableId]: mainSubscription },
      { [branchSubscription.stableId]: branchSubscription },
    );
    expect(
      changes.some((change) => change instanceof AlterSubscriptionSetOwner),
    ).toBe(true);
    expect(
      changes.some((change) => change instanceof CreateCommentOnSubscription),
    ).toBe(true);

    const removeCommentSubscription = new Subscription({
      ...baseProps,
      comment: null,
    });
    const dropCommentChanges = diffSubscriptions(
      { [branchSubscription.stableId]: branchSubscription },
      { [removeCommentSubscription.stableId]: removeCommentSubscription },
    );
    expect(
      dropCommentChanges.some(
        (change) => change instanceof DropCommentOnSubscription,
      ),
    ).toBe(true);
  });

  test("two_phase change triggers drop and recreate", () => {
    const mainSubscription = new Subscription(baseProps);
    const branchSubscription = new Subscription({
      ...baseProps,
      two_phase: true,
    });
    const changes = diffSubscriptions(
      { [mainSubscription.stableId]: mainSubscription },
      { [branchSubscription.stableId]: branchSubscription },
    );
    expect(
      changes.filter((change) => change instanceof DropSubscription).length,
    ).toBe(1);
    expect(
      changes.filter((change) => change instanceof CreateSubscription).length,
    ).toBe(1);
  });
});

