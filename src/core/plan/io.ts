/**
 * Plan I/O utilities for serializing and deserializing plans to/from JSON.
 */

import { PlanSchema, type Plan } from "./types.ts";

/**
 * Serialize a plan to JSON string.
 */
export function serializePlan(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}

/**
 * Deserialize a plan from JSON string.
 */
export function deserializePlan(json: string): Plan {
  const parsed = JSON.parse(json);
  return PlanSchema.parse(parsed);
}
