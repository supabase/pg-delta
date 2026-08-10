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

/** Diagnostic code for an extension-intent object whose reconstruction needs
 *  privileges the profile's assumed executor does not have — today, a pg_cron
 *  job owned by a role OTHER than the profile's default job owner (pg_cron
 *  demands SUPERUSER for any non-NULL `username` argument, so the replay can
 *  only be applied by a superuser connection). Warn + EMIT: the fact and its
 *  statement are still produced, so a superuser executor can apply them; the
 *  warning is the early signal that a plain connection will be rejected. */
export const INTENT_PRIVILEGED = "intent-privileged";

/** Diagnostic code for an extension-intent object the handler can KEY but
 *  cannot faithfully REPLAY, because the extension's own catalog does not
 *  record everything its constructor needs — today, a PARTITIONED pgmq queue
 *  (`pgmq.meta` stores the `is_partitioned` flag but not the partition /
 *  retention intervals, which live in pg_partman's `part_config`). Skip + warn
 *  is the honest outcome: emitting a fact whose `create()` guesses the missing
 *  arguments would produce a plan that can never converge. Distinct from
 *  {@link INTENT_UNKEYED} (no stable identity at all) and
 *  {@link INTENT_PRIVILEGED} (replayable, but only by a superuser). A warning
 *  on the SOURCE side (unmanaged drift, left untouched); on the DESIRED side
 *  `plan()` treats it as fatal, mirroring {@link INTENT_UNKEYED} — the skipped
 *  fact would otherwise turn a same-key transition (regular → partitioned
 *  queue) into a bare destructive drop whose proof falsely converges. */
export const INTENT_UNSUPPORTED = "intent-unsupported";

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
