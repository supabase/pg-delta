/**
 * Execution (target-architecture §3.8, stage 6): sequential, lock-aware,
 * segmented. Actions self-declare transactionality; the executor groups
 * maximal transactional runs, isolates nonTransactional actions, and
 * honors the planner's commitBoundaryAfter segment boundaries.
 * Segmentation changes transaction boundaries only, never order.
 *
 * Mid-plan failure semantics are explicit: every action is reported
 * applied / unapplied / inDoubt, and the error identifies whether an action
 * or an executor control statement failed. A failure inside a transaction
 * segment rolls that segment back (its actions report unapplied); earlier
 * segments are committed (applied); a failure AT commit reports the segment
 * inDoubt.
 */
import type { Pool } from "pg";
import type { FactBase } from "../core/fact.ts";
import { extract } from "../extract/extract.ts";
import { ENGINE_VERSION, type Plan } from "../plan/plan.ts";
import { assertDestructionMetadataIntegrity } from "../plan/safety.ts";
import { reconstructManagedView } from "../policy/reconstruct.ts";
import { buildApplyPreamble } from "./apply-preamble.ts";

export type ActionStatus = "applied" | "unapplied" | "inDoubt";

export interface ApplyError {
  /** First affected action for controls; exact failing action otherwise. */
  actionIndex: number;
  /** Absent on legacy consumer-authored errors; interpreted as `"action"`. */
  statementKind?: "action" | "control";
  sql: string;
  message: string;
}

type ApplyStatementKind = NonNullable<ApplyError["statementKind"]>;
type ProducedApplyError = ApplyError & { statementKind: ApplyStatementKind };

export interface ApplyReport {
  status: "applied" | "failed";
  /** count of actions in committed segments */
  appliedActions: number;
  /** one entry per plan action, in plan order */
  actionStatuses: ActionStatus[];
  error?: ApplyError;
}

/** Observability events emitted during `apply()` (statement-level debugging
 *  for `schema apply --verbose`). Purely additive — no event ever changes
 *  what apply() does or reports; see the `onEvent` doc comment below.
 *
 *  The applied statements are planner-rendered atomic DDL, not the authored
 *  declarative SQL, so `actionStart`/`actionEnd` alone are not a complete
 *  record of the wire: `control` covers every OTHER statement apply() sends
 *  on the same connection — `BEGIN`, each preamble `SET`/`SET LOCAL`, `COMMIT`,
 *  `ROLLBACK` (including best-effort rollbacks on an error path), and
 *  `RESET ALL` — so a `--verbose` trace shows exactly what ran, transaction
 *  framing included. */
export type ApplyEvent =
  | {
      kind: "segmentStart";
      segmentIndex: number;
      segmentCount: number;
      start: number;
      end: number;
      transactional: boolean;
    }
  | { kind: "actionStart"; actionIndex: number; sql: string }
  | { kind: "actionEnd"; actionIndex: number; ok: boolean; ms: number }
  | {
      kind: "segmentEnd";
      segmentIndex: number;
      outcome: "committed" | "rolledBack" | "inDoubt" | "failed";
    }
  | { kind: "control"; sql: string };

export interface ApplyOptions {
  /** re-extract the target and require its fingerprint to equal the
   *  plan's source fingerprint (stage 6 deliverable 3). Defaults to ON;
   *  harnesses that just proved the fingerprint may skip it. */
  fingerprintGate?: boolean;
  /** per-segment lock/statement timeouts (operational policy) */
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  /** resolved platform baseline (§3.9), required to reconstruct the fingerprint
   *  gate for a baseline-shaped plan — the baseline is NOT carried in the plan
   *  artifact. If the plan's policy declares a baseline and this is absent, the
   *  gate fails loudly rather than mis-comparing. */
  baseline?: FactBase;
  /** how to re-extract the target for the fingerprint gate. Defaults to the core
   *  `extract`. An integration with extension handlers MUST pass a handler-aware
   *  re-extractor — `extract(pool, { handlers })`, which the resolved profile
   *  supplies as `applyOptions.reextract` — so the gate emits the same
   *  `managedBy` edges and `resolveView` reconstructs the SAME managed view the
   *  plan was fingerprinted from; otherwise operationally-managed objects present
   *  on the real target read as drift and reject a valid managed plan. */
  reextract?: (pool: Pool) => Promise<{ factBase: FactBase }>;
  /** observability hook (statement-level debugging): fired at segment/action
   *  boundaries as apply() executes. Purely additive — see `emit` below for
   *  the isolation guarantee. */
  onEvent?: (event: ApplyEvent) => void;
}

interface Segment {
  /** indexes into plan.actions, contiguous and in order */
  start: number;
  end: number; // exclusive
  transactional: boolean;
}

/** Group actions into maximal transactional runs; nonTransactional actions
 *  run alone; a commitBoundaryAfter action UNCONDITIONALLY ends its
 *  transactional segment (its effect is unusable before COMMIT — ALTER TYPE …
 *  ADD VALUE — so nothing after it may share its transaction, regardless of
 *  graph-successor shape, review #6); newSegmentBefore forces a commit between
 *  two runs (used by compaction protection). */
export function segmentActions(
  actions: ReadonlyArray<{
    transactionality:
      | "transactional"
      | "nonTransactional"
      | "commitBoundaryAfter";
    newSegmentBefore: boolean;
  }>,
): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    if (action.transactionality === "nonTransactional") {
      if (i > start) segments.push({ start, end: i, transactional: true });
      segments.push({ start: i, end: i + 1, transactional: false });
      start = i + 1;
    } else if (action.transactionality === "commitBoundaryAfter") {
      // close the transactional segment AFTER this action, unconditionally
      segments.push({ start, end: i + 1, transactional: true });
      start = i + 1;
    } else if (action.newSegmentBefore && i > start) {
      segments.push({ start, end: i, transactional: true });
      start = i;
    }
  }
  if (start < actions.length) {
    segments.push({ start, end: actions.length, transactional: true });
  }
  return segments;
}

function errorEntry(
  actionIndex: number,
  statementKind: ApplyStatementKind,
  sql: string,
  error: unknown,
): ProducedApplyError {
  return {
    actionIndex,
    statementKind,
    sql,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Fire an observer event, swallowing anything it throws. `onEvent` is a
 *  debugging hook (`schema apply --verbose`), never a semantics participant —
 *  a throwing observer must NEVER change apply's control flow, action
 *  statuses, or the returned report, so every emission is wrapped here rather
 *  than left to each call site. */
function emit(
  onEvent: ((event: ApplyEvent) => void) | undefined,
  event: ApplyEvent,
): void {
  if (onEvent === undefined) return;
  try {
    // a `void`-typed callback may still be an async function (TypeScript
    // allows it), whose rejection is invisible to this try/catch — consume a
    // returned thenable so it cannot surface as an unhandled rejection and
    // take down the process mid-apply.
    const result = onEvent(event) as unknown;
    if (
      result !== null &&
      (typeof result === "object" || typeof result === "function") &&
      typeof (result as PromiseLike<unknown>).then === "function"
    ) {
      Promise.resolve(result as PromiseLike<unknown>).catch(() => {});
    }
  } catch {
    // swallowed by design — see doc comment above
  }
}

export async function apply(
  thePlan: Plan,
  target: Pool,
  options?: ApplyOptions,
): Promise<ApplyReport> {
  if (thePlan.formatVersion !== 1) {
    throw new Error(
      `apply: unsupported plan formatVersion ${String(thePlan.formatVersion)}`,
    );
  }
  if (thePlan.engineVersion !== ENGINE_VERSION) {
    throw new Error(
      `apply: plan was produced by engine ${thePlan.engineVersion}, this engine is ${ENGINE_VERSION} — re-plan`,
    );
  }
  assertDestructionMetadataIntegrity(
    thePlan.actions,
    thePlan.acceptedRenames,
    "apply",
  );
  if (options?.fingerprintGate !== false) {
    // Gate against the SAME managed view the plan was produced from (P0-2).
    // plan() fingerprints the resolveView'd source (extension-member + policy +
    // capability + baseline projection), so the raw re-extract must be resolved
    // the same way before comparing — otherwise an excluded object that is
    // present on the real database (an extension's internals, a policy-scoped
    // schema/role) reads as drift and rejects a valid scoped plan.
    if (
      thePlan.policy?.baseline !== undefined &&
      options?.baseline === undefined
    ) {
      throw new Error(
        `apply: plan was produced with policy "${thePlan.policy.id}" declaring baseline ` +
          `"${thePlan.policy.baseline}", but no baseline was supplied to reconstruct the ` +
          `fingerprint gate. Pass the resolved baseline as options.baseline, or skip the ` +
          `gate with fingerprintGate:false if convergence was already proven.`,
      );
    }
    // re-extract the target with the SAME redaction mode the plan was
    // fingerprinted with (Plan.redactSecrets, default true) — a custom
    // `reextract` is trusted to already bake in the right mode (the CLI's
    // profile-aware reextractors do); the bare default must be told
    // explicitly, or a plan built from `extract({ redactSecrets: false })`
    // state is spuriously rejected here (placeholder vs real secret hashes).
    const current = await (options?.reextract
      ? options.reextract(target)
      : extract(target, { redactSecrets: thePlan.redactSecrets ?? true }));
    // reconstruct the SAME managed-view-under-scope the plan fingerprinted
    // (`reconstructManagedView` seals resolveView → scope; defaults cluster).
    const view = reconstructManagedView(current.factBase, {
      policy: thePlan.policy,
      capability: thePlan.capability,
      baseline: options?.baseline,
      scope: thePlan.scope,
      defaultOwner: thePlan.defaultOwner,
    });
    // KNOWN PITFALL (acknowledged, by design): the fingerprint folds the WHOLE
    // resolved view, INCLUDING `referenceOnly` assumed-schema facts (e.g.
    // `auth.users` kept so a managed dependent resolves its parent). Those facts
    // never produce a diff delta, but they DO move the fingerprint. So if the
    // platform mutates an unmanaged assumed-schema object between plan and apply,
    // this gate trips and asks for a re-plan even though the managed delta is
    // unchanged. That is intentional: plan and apply must run against the SAME
    // baseline for the plan to be provably applicable; if the baseline shifted,
    // regenerating the plan is the correct, safe response (use fingerprintGate:
    // false / --force only when convergence was already proven). Excluding
    // referenceOnly facts from the fingerprint was considered (PR #307) and
    // declined to keep this guarantee. See the same note on FactBase.rootHash.
    if (view.rootHash !== thePlan.source.fingerprint) {
      throw new Error(
        `apply: fingerprint gate failed — the target's resolved state (${view.rootHash.slice(0, 12)}…) is not the plan's source (${thePlan.source.fingerprint.slice(0, 12)}…); re-plan against the current state`,
      );
    }
  }

  const statuses: ActionStatus[] = thePlan.actions.map(() => "unapplied");
  const segments = segmentActions(thePlan.actions);
  let appliedActions = 0;

  const client = await target.connect();
  let destroyClient = false;
  try {
    const onEvent = options?.onEvent;
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const segment = segments[segIdx]!;
      // segmentStart fires before the preamble/BEGIN for this segment, for
      // BOTH transactional and non-transactional segments.
      emit(onEvent, {
        kind: "segmentStart",
        segmentIndex: segIdx,
        segmentCount: segments.length,
        start: segment.start,
        end: segment.end,
        transactional: segment.transactional,
      });

      if (!segment.transactional) {
        // a lone non-transactional action; session-level settings, reset after
        const index = segment.start;
        const action = thePlan.actions[index]!;
        // the failure return is deferred past the finally so segmentEnd stays
        // the segment's LAST event — after the RESET ALL control — on every
        // path; a trace must never show wire traffic after the outcome line.
        let failure: ProducedApplyError | undefined;
        let currentKind: ApplyStatementKind = "control";
        let currentSql = "";
        try {
          // session-level preamble SETs hit the wire BEFORE the action; a
          // preamble failure emits NO action events (the action never ran).
          for (const sql of buildApplyPreamble(thePlan, options, false)) {
            currentKind = "control";
            currentSql = sql;
            emit(onEvent, { kind: "control", sql });
            await client.query(sql);
          }
          currentKind = "action";
          currentSql = action.sql;
          emit(onEvent, {
            kind: "actionStart",
            actionIndex: index,
            sql: action.sql,
          });
          const actionStartedAt = performance.now();
          try {
            await client.query(action.sql);
            // actionEnd fires as the action settles, so `ms` measures only the
            // action's round-trip (not the RESET ALL below).
            const actionElapsedMs = performance.now() - actionStartedAt;
            emit(onEvent, {
              kind: "actionEnd",
              actionIndex: index,
              ok: true,
              ms: actionElapsedMs,
            });
          } catch (error) {
            const actionElapsedMs = performance.now() - actionStartedAt;
            emit(onEvent, {
              kind: "actionEnd",
              actionIndex: index,
              ok: false,
              ms: actionElapsedMs,
            });
            throw error;
          }
        } catch (error) {
          if (currentKind === "action") {
            // A failed non-transactional DDL is NOT safely unapplied — it can
            // leave durable side effects (e.g. an INVALID index from a
            // cancelled CREATE INDEX CONCURRENTLY).
            statuses[index] = "inDoubt";
          }
          failure = errorEntry(index, currentKind, currentSql, error);
        }

        // ALWAYS restore session state before the client returns to the pool,
        // on success or failure. A cleanup failure never replaces the primary
        // failure, and its connection is destroyed instead of being reused.
        emit(onEvent, { kind: "control", sql: "RESET ALL" });
        let resetFailed = false;
        let resetError: unknown;
        try {
          await client.query("RESET ALL");
        } catch (error) {
          resetFailed = true;
          resetError = error;
          destroyClient = true;
        }

        if (failure !== undefined) {
          emit(onEvent, {
            kind: "segmentEnd",
            segmentIndex: segIdx,
            outcome: failure.statementKind === "action" ? "inDoubt" : "failed",
          });
          return {
            status: "failed",
            appliedActions,
            actionStatuses: statuses,
            error: failure,
          };
        }
        // The action completed in autocommit before RESET ALL ran, so a RESET
        // failure cannot relabel that durable action inDoubt or unapplied.
        statuses[index] = "applied";
        appliedActions += 1;
        if (resetFailed) {
          emit(onEvent, {
            kind: "segmentEnd",
            segmentIndex: segIdx,
            outcome: "failed",
          });
          return {
            status: "failed",
            appliedActions,
            actionStatuses: statuses,
            error: errorEntry(index, "control", "RESET ALL", resetError),
          };
        }
        emit(onEvent, {
          kind: "segmentEnd",
          segmentIndex: segIdx,
          outcome: "committed",
        });
        continue;
      }

      let setupSql = "BEGIN";
      try {
        emit(onEvent, { kind: "control", sql: "BEGIN" });
        await client.query("BEGIN");
        for (const sql of buildApplyPreamble(thePlan, options, true)) {
          setupSql = sql;
          emit(onEvent, { kind: "control", sql });
          await client.query(sql);
        }
      } catch (error) {
        emit(onEvent, { kind: "control", sql: "ROLLBACK" });
        try {
          await client.query("ROLLBACK");
        } catch {
          destroyClient = true;
        }
        emit(onEvent, {
          kind: "segmentEnd",
          segmentIndex: segIdx,
          outcome: "failed",
        });
        return {
          status: "failed",
          appliedActions,
          actionStatuses: statuses,
          error: errorEntry(segment.start, "control", setupSql, error),
        };
      }
      for (let i = segment.start; i < segment.end; i++) {
        const action = thePlan.actions[i]!;
        emit(onEvent, { kind: "actionStart", actionIndex: i, sql: action.sql });
        const actionStartedAt = performance.now();
        try {
          await client.query(action.sql);
        } catch (error) {
          const actionElapsedMs = performance.now() - actionStartedAt;
          emit(onEvent, {
            kind: "actionEnd",
            actionIndex: i,
            ok: false,
            ms: actionElapsedMs,
          });
          emit(onEvent, { kind: "control", sql: "ROLLBACK" });
          let rollbackSucceeded = true;
          try {
            await client.query("ROLLBACK");
          } catch {
            rollbackSucceeded = false;
            destroyClient = true;
          }
          emit(onEvent, {
            kind: "segmentEnd",
            segmentIndex: segIdx,
            outcome: rollbackSucceeded ? "rolledBack" : "failed",
          });
          return {
            status: "failed",
            appliedActions,
            actionStatuses: statuses,
            error: errorEntry(i, "action", action.sql, error),
          };
        }
        const actionElapsedMs = performance.now() - actionStartedAt;
        emit(onEvent, {
          kind: "actionEnd",
          actionIndex: i,
          ok: true,
          ms: actionElapsedMs,
        });
      }
      try {
        emit(onEvent, { kind: "control", sql: "COMMIT" });
        await client.query("COMMIT");
      } catch (error) {
        // the commit itself failed: the segment's fate is unknown
        for (let i = segment.start; i < segment.end; i++)
          statuses[i] = "inDoubt";
        emit(onEvent, { kind: "control", sql: "ROLLBACK" });
        try {
          await client.query("ROLLBACK");
        } catch {
          destroyClient = true;
        }
        emit(onEvent, {
          kind: "segmentEnd",
          segmentIndex: segIdx,
          outcome: "inDoubt",
        });
        return {
          status: "failed",
          appliedActions,
          actionStatuses: statuses,
          error: errorEntry(segment.start, "control", "COMMIT", error),
        };
      }
      for (let i = segment.start; i < segment.end; i++) statuses[i] = "applied";
      appliedActions += segment.end - segment.start;
      emit(onEvent, {
        kind: "segmentEnd",
        segmentIndex: segIdx,
        outcome: "committed",
      });
    }
  } finally {
    if (destroyClient) client.release(true);
    else client.release();
  }
  return {
    status: "applied",
    appliedActions,
    actionStatuses: statuses,
  };
}
