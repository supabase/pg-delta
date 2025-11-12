// src/objects/subscription/utils.ts
import { quoteLiteral } from "../base.change.ts";
import type { Subscription } from "./subscription.model.ts";

/**
 * Subscription parameters that can be manipulated via `ALTER SUBSCRIPTION ... SET (...)`.
 * The list intentionally mirrors the options we surface in diff output. When you add a new
 * entry here, make sure the corresponding serialization/version handling exists in
 * `getSubscriptionOptionValue` and in the SQL emitter.
 */
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

/**
 * Resolve the textual value we should emit for a given subscription option.
 *
 * Each branch encodes the quirks we already normalize in the model. For example,
 * `slot_name` collapses to `NONE` when the subscription was extracted without an
 * associated logical slot, while `streaming` stays free-form because PG 17+ allows
 * enumerated values (`on`/`off`/`parallel`).
 */
function getSubscriptionOptionValue(
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

/**
 * Convenience helper used by ALTER change classes. It stitches the option key/value
 * into the canonical `"key = value"` form that PostgreSQL expects.
 */
export function formatSubscriptionOption(
  subscription: Subscription,
  option: SubscriptionSettableOption,
): string {
  return `${option} = ${getSubscriptionOptionValue(subscription, option)}`;
}

/**
 * Collect all options that should accompany a CREATE/ALTER statement.
 *
 * This routine encapsulates the nuanced logic around default slot handling and
 * version-dependent fields:
 *  - When `includeEnabled` is true we emit `enabled = false` for disabled subs so that
 *    recreating them does not inadvertently enable replication.
 *  - When we know no replication slot exists we force `slot_name = NONE`, plus
 *    `connect = false` / `create_slot = false` in the caller.
 *  - Optional flags (`streaming`, `password_required`, `origin`, etc.) are emitted only
 *    when their value deviates from the PostgreSQL defaults.
 *
 * Callers can toggle `includeTwoPhase` / `includeEnabled` to opt-in to those
 * adjustments depending on which statement is being generated.
 */
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
