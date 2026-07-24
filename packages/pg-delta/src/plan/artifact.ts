/**
 * Plan artifact v1 (stage 6 deliverable 1): a plan is a durable,
 * version-tagged JSON document that round-trips losslessly. `apply`
 * accepts the artifact, never a bare SQL list, and refuses artifacts
 * whose formatVersion/engineVersion it does not understand (the version
 * check itself lives in apply.ts; this module owns the byte format).
 *
 * Payload values can contain bigints (sequence bounds); they are encoded
 * as {"$bigint": "…"} exactly like fact snapshots (stage 1).
 */
import { ENGINE_VERSION, type Plan } from "./plan.ts";
import { normalizeProjectionAudit } from "../policy/reconstruct.ts";

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    "$bigint" in value &&
    typeof (value as { $bigint: unknown }).$bigint === "string" &&
    Object.keys(value).length === 1
  ) {
    return BigInt((value as { $bigint: string }).$bigint);
  }
  return value;
}

export function serializePlan(thePlan: Plan): string {
  return JSON.stringify(thePlan, replacer, 2);
}

export function parsePlan(json: string): Plan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json, reviver);
  } catch (error) {
    throw new Error(
      `plan artifact: not valid JSON — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("plan artifact: expected a JSON object");
  }
  const artifact = parsed as Partial<Plan>;
  if (artifact.formatVersion !== 1) {
    throw new Error(
      `plan artifact: unsupported formatVersion ${String(artifact.formatVersion)} (this engine reads 1)`,
    );
  }
  if (typeof artifact.engineVersion !== "string") {
    throw new Error("plan artifact: missing engineVersion");
  }
  if (artifact.engineVersion !== ENGINE_VERSION) {
    throw new Error(
      `plan artifact: produced by engine ${artifact.engineVersion}, this engine is ${ENGINE_VERSION} — re-plan`,
    );
  }
  if (!Array.isArray(artifact.actions) || !Array.isArray(artifact.deltas)) {
    throw new Error("plan artifact: missing actions/deltas");
  }
  if (
    artifact.source?.fingerprint === undefined ||
    artifact.target?.fingerprint === undefined
  ) {
    throw new Error("plan artifact: missing source/target fingerprints");
  }
  if (artifact.projectionAudit !== undefined) {
    try {
      artifact.projectionAudit = normalizeProjectionAudit(
        artifact.projectionAudit,
      );
    } catch (error) {
      throw new Error(
        `plan artifact: invalid projectionAudit — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return artifact as Plan;
}
