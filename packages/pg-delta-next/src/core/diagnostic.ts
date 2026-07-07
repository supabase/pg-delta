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

/** Thrown by public API stubs for not-yet-implemented stages (stage 0). */
export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`Not implemented: ${feature}`);
    this.name = "NotImplementedError";
  }
}
