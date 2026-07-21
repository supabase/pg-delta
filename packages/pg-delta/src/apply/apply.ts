/**
 * Execution (target-architecture §3.8, stage 6): sequential, lock-aware,
 * segmented. Actions self-declare transactionality; the executor groups
 * maximal transactional runs, isolates nonTransactional actions, and
 * honors the planner's commitBoundaryAfter segment boundaries.
 * Segmentation changes transaction boundaries only, never order.
 *
 * Mid-plan failure semantics are explicit: every action is reported
 * applied / unapplied / inDoubt. A failure inside a transaction segment
 * rolls that segment back (its actions report unapplied); earlier
 * segments are committed (applied); a failure AT commit reports the
 * segment inDoubt.
 */
import type { Pool } from "pg";
import type { FactBase } from "../core/fact.ts";
import { extract } from "../extract/extract.ts";
import { ENGINE_VERSION, type Plan } from "../plan/plan.ts";
import { reconstructManagedView } from "../policy/reconstruct.ts";

export type ActionStatus = "applied" | "unapplied" | "inDoubt";

export interface ApplyReport {
  status: "applied" | "failed";
  /** count of actions in committed segments */
  appliedActions: number;
  /** one entry per plan action, in plan order */
  actionStatuses: ActionStatus[];
  error?: { actionIndex: number; sql: string; message: string };
}

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
  sql: string,
  error: unknown,
): NonNullable<ApplyReport["error"]> {
  return {
    actionIndex,
    sql,
    message: error instanceof Error ? error.message : String(error),
  };
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
  try {
    const preamble = (local: boolean): string[] => [
      ...(options?.lockTimeoutMs !== undefined
        ? [
            `SET ${local ? "LOCAL " : ""}lock_timeout = ${options.lockTimeoutMs}`,
          ]
        : []),
      ...(options?.statementTimeoutMs !== undefined
        ? [
            `SET ${local ? "LOCAL " : ""}statement_timeout = ${options.statementTimeoutMs}`,
          ]
        : []),
      ...thePlan.preamble.map(
        (s) => `SET ${local ? "LOCAL " : ""}${s.name} = ${s.value}`,
      ),
    ];

    for (const segment of segments) {
      if (!segment.transactional) {
        // a lone non-transactional action; session-level settings, reset after
        const index = segment.start;
        const action = thePlan.actions[index]!;
        try {
          for (const sql of preamble(false)) await client.query(sql);
          await client.query(action.sql);
        } catch (error) {
          // a failed non-transactional DDL is NOT safely unapplied — it can
          // leave durable side effects (e.g. an INVALID index from a cancelled
          // CREATE INDEX CONCURRENTLY). Report it inDoubt so the caller knows
          // the database must be re-extracted before retry (review P1).
          statuses[index] = "inDoubt";
          return {
            status: "failed",
            appliedActions,
            actionStatuses: statuses,
            error: errorEntry(index, action.sql, error),
          };
        } finally {
          // ALWAYS restore session state before the client returns to the pool,
          // on success or failure — RESET ALL must not be skipped by the catch's
          // early return, and a reset failure must not flip the action's outcome.
          await client.query("RESET ALL").catch(() => {});
        }
        statuses[index] = "applied";
        appliedActions += 1;
        continue;
      }

      try {
        await client.query("BEGIN");
        for (const sql of preamble(true)) await client.query(sql);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        return {
          status: "failed",
          appliedActions,
          actionStatuses: statuses,
          error: errorEntry(segment.start, "BEGIN", error),
        };
      }
      for (let i = segment.start; i < segment.end; i++) {
        const action = thePlan.actions[i]!;
        try {
          await client.query(action.sql);
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          return {
            status: "failed",
            appliedActions,
            actionStatuses: statuses,
            error: errorEntry(i, action.sql, error),
          };
        }
      }
      try {
        await client.query("COMMIT");
      } catch (error) {
        // the commit itself failed: the segment's fate is unknown
        for (let i = segment.start; i < segment.end; i++)
          statuses[i] = "inDoubt";
        await client.query("ROLLBACK").catch(() => {});
        return {
          status: "failed",
          appliedActions,
          actionStatuses: statuses,
          error: errorEntry(segment.start, "COMMIT", error),
        };
      }
      for (let i = segment.start; i < segment.end; i++) statuses[i] = "applied";
      appliedActions += segment.end - segment.start;
    }
  } finally {
    client.release();
  }
  return {
    status: "applied",
    appliedActions,
    actionStatuses: statuses,
  };
}
