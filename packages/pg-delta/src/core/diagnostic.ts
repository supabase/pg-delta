/**
 * The one shared diagnostic shape used by every layer (stage-1 deliverable 7):
 * extraction's unresolved references, loader rejections, planner failures,
 * apply reports. One shape → one CLI renderer.
 */
import type { StableId } from "./stable-id.ts";

export interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  subject?: StableId;
  message: string;
  context?: Record<string, unknown>;
}

/** Diagnostic code for an extension-intent object that cannot be given a stable
 *  key (e.g. an unnamed pg_cron job). A handler emits it during capture; on the
 *  SOURCE side it is a warning (the object is simply unmanaged), but on the
 *  DESIRED side `plan()` treats it as fatal — declared intent the engine cannot
 *  key can never converge. Shared here so the emitter (a handler) and the gate
 *  (`plan()`) agree on the string without a cross-layer import. */
export const INTENT_UNKEYED = "intent-unkeyed";

/** Diagnostic code for a `pg_user_mapping` row whose options a non-superuser
 *  extraction could not read (the `pg_user_mappings` fallback view NULLs
 *  `umoptions` for a row the caller isn't authorized on — see
 *  `src/extract/foreign.ts`). The mapping fact is SKIPPED rather than
 *  recorded with fabricated empty options, so its true state is UNKNOWN on
 *  that side. A warning at extraction time is not enough on its own: if the
 *  OTHER side of a diff can see the mapping, the missing fact reads as an
 *  intentional add/remove and `plan()` would emit a wrong CREATE/DROP USER
 *  MAPPING. `plan()` escalates to fatal exactly when a delta actually touches
 *  one of these subjects (mirrors `INTENT_UNKEYED` above). Shared here so the
 *  emitter (`extractForeign`) and the gate (`plan()`) agree on the string
 *  without a cross-layer import. */
export const USER_MAPPING_UNREADABLE = "user-mapping-unreadable";

/** Thrown by public API stubs for not-yet-implemented stages (stage 0). */
export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`Not implemented: ${feature}`);
    this.name = "NotImplementedError";
  }
}
