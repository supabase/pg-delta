// src/objects/subscription/utils.ts
import { quoteLiteral } from "../base.change.ts";
import type { Subscription } from "./subscription.model.ts";

export type SubscriptionSettableOption =
  | "slot_name"
  | "binary"
  | "streaming"
  | "synchronous_commit"
  | "disable_on_error"
  | "password_required"
  | "run_as_owner"
  | "origin"
  | "failover";

interface CollectOptions {
  includeEnabled?: boolean;
  includeTwoPhase?: boolean;
}

export function getSubscriptionOptionValue(
  subscription: Subscription,
  option: SubscriptionSettableOption,
): string {
  switch (option) {
    case "slot_name": {
      if (subscription.slot_is_none) return "NONE";
      if (subscription.slot_name) return quoteLiteral(subscription.slot_name);
      return quoteLiteral(subscription.raw_name);
    }
    case "binary":
      return subscription.binary ? "true" : "false";
    case "streaming":
      return quoteLiteral(subscription.streaming);
    case "synchronous_commit":
      return quoteLiteral(subscription.synchronous_commit);
    case "disable_on_error":
      return subscription.disable_on_error ? "true" : "false";
    case "password_required":
      return subscription.password_required ? "true" : "false";
    case "run_as_owner":
      return subscription.run_as_owner ? "true" : "false";
    case "origin":
      return quoteLiteral(subscription.origin);
    case "failover":
      return subscription.failover ? "true" : "false";
    default: {
      const _exhaustive: never = option;
      return _exhaustive;
    }
  }
}

export function formatSubscriptionOption(
  subscription: Subscription,
  option: SubscriptionSettableOption,
): string {
  return `${option} = ${getSubscriptionOptionValue(subscription, option)}`;
}

export function formatSubscriptionWithClause(
  subscription: Subscription,
  options: CollectOptions = {},
): string[] {
  const entries = collectSubscriptionOptions(subscription, options);
  return entries.map(({ key, value }) => `${key} = ${value}`);
}

export function collectSubscriptionOptions(
  subscription: Subscription,
  { includeEnabled = false, includeTwoPhase = false }: CollectOptions = {},
) {
  const entries: { key: string; value: string }[] = [];

  if (includeEnabled && !subscription.enabled) {
    entries.push({ key: "enabled", value: "false" });
  }

  if (subscription.slot_is_none) {
    entries.push({ key: "slot_name", value: "NONE" });
  } else if (subscription.slot_name) {
    entries.push({
      key: "slot_name",
      value: quoteLiteral(subscription.slot_name),
    });
  }

  if (subscription.binary) {
    entries.push({ key: "binary", value: "true" });
  }

  if (subscription.streaming !== "off") {
    entries.push({
      key: "streaming",
      value: quoteLiteral(subscription.streaming),
    });
  }

  if (subscription.synchronous_commit !== "off") {
    entries.push({
      key: "synchronous_commit",
      value: quoteLiteral(subscription.synchronous_commit),
    });
  }

  if (includeTwoPhase && subscription.two_phase) {
    entries.push({ key: "two_phase", value: "true" });
  }

  if (subscription.disable_on_error) {
    entries.push({ key: "disable_on_error", value: "true" });
  }

  if (!subscription.password_required) {
    entries.push({ key: "password_required", value: "false" });
  }

  if (subscription.run_as_owner) {
    entries.push({ key: "run_as_owner", value: "true" });
  }

  if (subscription.origin === "none") {
    entries.push({ key: "origin", value: quoteLiteral("none") });
  }

  if (subscription.failover) {
    entries.push({ key: "failover", value: "true" });
  }

  return entries;
}
