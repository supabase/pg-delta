/**
 * Statement-level debugging for `schema apply` (issue: observability into
 * exactly what apply() executes). apply() gains an optional `onEvent`
 * observer (src/apply/apply.ts) that reports segment/action boundaries as
 * they happen — additive only: no event may change apply()'s control flow,
 * action statuses, or the returned ApplyReport.
 *
 * Drives extract -> plan -> apply directly against two real databases (the
 * same pattern as tests/execution.test.ts), so the event stream reflects the
 * production execution path, not a hand-rolled fixture.
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
// ApplyEvent is advertised as public library API (see the changeset), so pin
// that it is exported from the package entry, not just the internal module.
import type { ApplyEvent } from "../src/index.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { sharedCluster } from "./containers.ts";

describe("apply() onEvent observer", () => {
  test("happy path: segmentStart, actionStart/actionEnd(ok:true) pairs in plan order, segmentEnd committed", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("apply_observer_tgt");
    const desired = await cluster.createDb("apply_observer_desired");
    try {
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer PRIMARY KEY, name text);
        CREATE INDEX t_name_idx ON app.t (name);
      `);
      const [targetState, desiredState] = [
        await extract(target.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(targetState.factBase, desiredState.factBase);
      expect(thePlan.actions.length).toBeGreaterThan(0);

      const events: ApplyEvent[] = [];
      const report = await apply(thePlan, target.pool, {
        fingerprintGate: false,
        onEvent: (e) => events.push(e),
      });
      expect(report.status).toBe("applied");

      // exactly one segmentStart/segmentEnd for a single-segment plan
      const segmentStarts = events.filter((e) => e.kind === "segmentStart");
      const segmentEnds = events.filter((e) => e.kind === "segmentEnd");
      expect(segmentStarts.length).toBeGreaterThan(0);
      expect(segmentEnds.length).toBe(segmentStarts.length);
      for (const e of segmentEnds) {
        expect(e.kind === "segmentEnd" && e.outcome).toBe("committed");
      }

      // actionStart/actionEnd pairs, in plan order, one per action, all ok
      const actionStarts = events.filter((e) => e.kind === "actionStart");
      const actionEnds = events.filter((e) => e.kind === "actionEnd");
      expect(actionStarts.length).toBe(thePlan.actions.length);
      expect(actionEnds.length).toBe(thePlan.actions.length);
      for (let i = 0; i < thePlan.actions.length; i++) {
        const s = actionStarts[i];
        const e = actionEnds[i];
        expect(s?.kind === "actionStart" && s.actionIndex).toBe(i);
        expect(s?.kind === "actionStart" && s.sql).toBe(
          thePlan.actions[i]!.sql,
        );
        expect(e?.kind === "actionEnd" && e.actionIndex).toBe(i);
        expect(e?.kind === "actionEnd" && e.ok).toBe(true);
        expect(e?.kind === "actionEnd" && typeof e.ms).toBe("number");
        expect(e?.kind === "actionEnd" && e.ms).toBeGreaterThanOrEqual(0);
      }

      // events interleave in the order apply() executes them: every
      // actionStart[i] is followed by its actionEnd[i] BEFORE the next
      // actionStart[i+1] begins — a refactor that batches starts or ends
      // would break the trace's statement-by-statement story.
      const startPositions: number[] = [];
      const endPositions: number[] = [];
      events.forEach((e, pos) => {
        if (e.kind === "actionStart") startPositions.push(pos);
        else if (e.kind === "actionEnd") endPositions.push(pos);
      });
      expect(startPositions.length).toBe(endPositions.length);
      for (let i = 0; i < startPositions.length; i++) {
        expect(endPositions[i]!).toBeGreaterThan(startPositions[i]!);
        if (i + 1 < startPositions.length) {
          expect(endPositions[i]!).toBeLessThan(startPositions[i + 1]!);
        }
      }
    } finally {
      await Promise.all([target.drop(), desired.drop()]);
    }
  }, 60_000);

  test("control events: BEGIN, the preamble SET, and COMMIT bracket the action events", async () => {
    // The statements apply() actually sends to the wire are NOT limited to
    // plan actions — BEGIN/COMMIT framing and preamble SETs go over the same
    // connection. `onEvent` must report those too (kind: "control"), so a
    // debugging trace is a COMPLETE record of the wire, not just the planner's
    // atomic DDL.
    const cluster = await sharedCluster();
    const target = await cluster.createDb("apply_observer_ctrl_tgt");
    const desired = await cluster.createDb("apply_observer_ctrl_desired");
    try {
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer PRIMARY KEY);
      `);
      const [targetState, desiredState] = [
        await extract(target.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(targetState.factBase, desiredState.factBase);
      expect(thePlan.actions.length).toBeGreaterThan(0);

      const events: ApplyEvent[] = [];
      const report = await apply(thePlan, target.pool, {
        fingerprintGate: false,
        lockTimeoutMs: 5000, // forces a preamble SET LOCAL lock_timeout
        onEvent: (e) => events.push(e),
      });
      expect(report.status).toBe("applied");

      const isControl = (
        e: ApplyEvent,
      ): e is Extract<ApplyEvent, { kind: "control" }> => e.kind === "control";
      const controlEvents = events.filter(isControl);
      expect(controlEvents.some((e) => e.sql === "BEGIN")).toBe(true);
      expect(
        controlEvents.some((e) => e.sql.startsWith("SET LOCAL lock_timeout")),
      ).toBe(true);
      expect(controlEvents.some((e) => e.sql === "COMMIT")).toBe(true);

      // ordering: BEGIN -> preamble SET -> first actionStart ... last actionEnd -> COMMIT -> segmentEnd
      const beginPos = events.findIndex(
        (e) => e.kind === "control" && e.sql === "BEGIN",
      );
      const setPos = events.findIndex(
        (e) =>
          e.kind === "control" && e.sql.startsWith("SET LOCAL lock_timeout"),
      );
      const firstActionStartPos = events.findIndex(
        (e) => e.kind === "actionStart",
      );
      const lastActionEndPos = events
        .map((e) => e.kind)
        .lastIndexOf("actionEnd");
      const commitPos = events.findIndex(
        (e) => e.kind === "control" && e.sql === "COMMIT",
      );
      const segmentEndPos = events.findIndex((e) => e.kind === "segmentEnd");

      expect(beginPos).toBeGreaterThanOrEqual(0);
      expect(beginPos).toBeLessThan(setPos);
      expect(setPos).toBeLessThan(firstActionStartPos);
      expect(commitPos).toBeGreaterThan(lastActionEndPos);
      expect(commitPos).toBeLessThan(segmentEndPos);
    } finally {
      await Promise.all([target.drop(), desired.drop()]);
    }
  }, 60_000);

  test("failure path: the failing action gets actionEnd ok:false, its segment gets segmentEnd rolledBack", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("apply_observer_fail_tgt");
    const desired = await cluster.createDb("apply_observer_fail_desired");
    try {
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer PRIMARY KEY);
      `);
      const [targetState, desiredState] = [
        await extract(target.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(targetState.factBase, desiredState.factBase);
      expect(thePlan.actions.length).toBeGreaterThan(0);

      // sabotage: pre-create the schema on the target so the planned
      // `CREATE SCHEMA app` action fails when replayed.
      await target.pool.query(`CREATE SCHEMA app`);

      const events: ApplyEvent[] = [];
      const report = await apply(thePlan, target.pool, {
        fingerprintGate: false,
        onEvent: (e) => events.push(e),
      });
      expect(report.status).toBe("failed");
      expect(report.error).toBeDefined();

      const failedIndex = report.error!.actionIndex;
      const actionEnds = events.filter((e) => e.kind === "actionEnd");
      const failedEnd = actionEnds.find(
        (e) => e.kind === "actionEnd" && e.actionIndex === failedIndex,
      );
      expect(failedEnd).toBeDefined();
      expect(failedEnd?.kind === "actionEnd" && failedEnd.ok).toBe(false);

      const segmentEnds = events.filter((e) => e.kind === "segmentEnd");
      expect(segmentEnds.length).toBeGreaterThan(0);
      // the (single) segment containing the failure rolled back
      expect(
        segmentEnds.some(
          (e) => e.kind === "segmentEnd" && e.outcome === "rolledBack",
        ),
      ).toBe(true);

      // report semantics unchanged: the failing action and everything after
      // it in its (rolled-back) segment reports unapplied.
      expect(report.actionStatuses[failedIndex]).toBe("unapplied");
    } finally {
      await Promise.all([target.drop(), desired.drop()]);
    }
  }, 60_000);

  // The non-transactional path (CREATE INDEX CONCURRENTLY under the
  // `concurrentIndexes` param) is the one this trace exists to debug — a
  // cancelled CIC leaves durable side effects — so its event ordering must
  // mirror the wire exactly: preamble SETs before the action, actionEnd when
  // the action settles (not after RESET ALL), segmentEnd terminal on every
  // path.
  test("non-transactional segment: preamble controls precede actionStart; actionEnd precedes RESET ALL; segmentEnd is terminal", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("apply_observer_ntx_tgt");
    const desired = await cluster.createDb("apply_observer_ntx_desired");
    try {
      await target.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, x text);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, x text);
        CREATE INDEX t_x_idx ON app.t (x);
      `);
      const [targetState, desiredState] = [
        await extract(target.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(targetState.factBase, desiredState.factBase, {
        params: { concurrentIndexes: true },
      });
      // the whole plan is the one CREATE INDEX CONCURRENTLY action, so the
      // event stream is exactly one non-transactional segment.
      expect(thePlan.actions.length).toBe(1);
      expect(thePlan.actions[0]?.transactionality).toBe("nonTransactional");

      const events: ApplyEvent[] = [];
      const report = await apply(thePlan, target.pool, {
        fingerprintGate: false,
        onEvent: (e) => events.push(e),
      });
      expect(report.status).toBe("applied");

      const kinds = events.map((e) => e.kind);
      const actionStartPos = kinds.indexOf("actionStart");
      const actionEndPos = kinds.indexOf("actionEnd");
      const resetPos = events.findIndex(
        (e) => e.kind === "control" && e.sql === "RESET ALL",
      );
      expect(actionStartPos).toBeGreaterThanOrEqual(0);
      expect(resetPos).toBeGreaterThanOrEqual(0);
      // wire order: every session-level preamble SET goes out BEFORE the
      // action statement …
      let sawPreambleSet = false;
      events.forEach((e, pos) => {
        if (e.kind === "control" && e.sql.startsWith("SET ")) {
          sawPreambleSet = true;
          expect(pos).toBeLessThan(actionStartPos);
        }
      });
      expect(sawPreambleSet).toBe(true); // plan.preamble is never empty
      // … and actionEnd fires when the action settles, BEFORE the RESET ALL
      // round-trip (so `ms` measures only the action itself) …
      expect(actionEndPos).toBeGreaterThan(actionStartPos);
      expect(resetPos).toBeGreaterThan(actionEndPos);
      // … and segmentEnd is the segment's terminal event on the success path.
      const last = events[events.length - 1]!;
      expect(last.kind).toBe("segmentEnd");
      expect(last.kind === "segmentEnd" && last.outcome).toBe("committed");
    } finally {
      await Promise.all([target.drop(), desired.drop()]);
    }
  }, 60_000);

  test("non-transactional failure: actionEnd(ok:false), then RESET ALL, then segmentEnd(inDoubt) as the terminal event", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("apply_observer_ntx_fail_tgt");
    const desired = await cluster.createDb("apply_observer_ntx_fail_desired");
    try {
      await target.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, x text);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, x text);
        CREATE INDEX t_x_idx ON app.t (x);
      `);
      const [targetState, desiredState] = [
        await extract(target.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(targetState.factBase, desiredState.factBase, {
        params: { concurrentIndexes: true },
      });
      expect(thePlan.actions.length).toBe(1);
      expect(thePlan.actions[0]?.transactionality).toBe("nonTransactional");

      // sabotage: pre-create the index name so CREATE INDEX CONCURRENTLY fails
      await target.pool.query(`CREATE INDEX t_x_idx ON app.t (id)`);

      const events: ApplyEvent[] = [];
      const report = await apply(thePlan, target.pool, {
        fingerprintGate: false,
        onEvent: (e) => events.push(e),
      });
      expect(report.status).toBe("failed");
      expect(report.actionStatuses[0]).toBe("inDoubt");

      const actionEndPos = events.findIndex((e) => e.kind === "actionEnd");
      const resetPos = events.findIndex(
        (e) => e.kind === "control" && e.sql === "RESET ALL",
      );
      const failedEnd = events[actionEndPos];
      expect(failedEnd?.kind === "actionEnd" && failedEnd.ok).toBe(false);
      // RESET ALL still hits the wire after the failure, and segmentEnd stays
      // the segment's terminal event — a `--verbose` trace must never print
      // wire traffic after the segment's outcome line.
      expect(resetPos).toBeGreaterThan(actionEndPos);
      const last = events[events.length - 1]!;
      expect(last.kind).toBe("segmentEnd");
      expect(last.kind === "segmentEnd" && last.outcome).toBe("inDoubt");
    } finally {
      await Promise.all([target.drop(), desired.drop()]);
    }
  }, 60_000);

  test("non-transactional preamble failure: no action events for an action that never reached the wire", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("apply_observer_ntx_pre_tgt");
    const desired = await cluster.createDb("apply_observer_ntx_pre_desired");
    try {
      await target.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, x text);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, x text);
        CREATE INDEX t_x_idx ON app.t (x);
      `);
      const [targetState, desiredState] = [
        await extract(target.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(targetState.factBase, desiredState.factBase, {
        params: { concurrentIndexes: true },
      });
      expect(thePlan.actions[0]?.transactionality).toBe("nonTransactional");

      // lock_timeout = -1 is outside Postgres's valid range, so the segment's
      // FIRST preamble SET fails — the action itself never reaches the wire.
      const events: ApplyEvent[] = [];
      const report = await apply(thePlan, target.pool, {
        fingerprintGate: false,
        lockTimeoutMs: -1,
        onEvent: (e) => events.push(e),
      });
      expect(report.status).toBe("failed");

      // the trace must not claim an action executed and failed when it was
      // the preamble that failed: no actionStart, no actionEnd.
      expect(events.some((e) => e.kind === "actionStart")).toBe(false);
      expect(events.some((e) => e.kind === "actionEnd")).toBe(false);
      const last = events[events.length - 1]!;
      expect(last.kind).toBe("segmentEnd");
      expect(last.kind === "segmentEnd" && last.outcome).toBe("inDoubt");
    } finally {
      await Promise.all([target.drop(), desired.drop()]);
    }
  }, 60_000);

  test("an ASYNC observer that rejects never surfaces an unhandled rejection or changes the outcome", async () => {
    // TypeScript allows an async function wherever a `void` callback is
    // expected, so a library caller can pass `onEvent: async () => {...}`.
    // A rejection from it is invisible to emit()'s synchronous try/catch —
    // it must be consumed, or it escapes as an unhandled rejection and can
    // take down the process mid-apply.
    const cluster = await sharedCluster();
    const target = await cluster.createDb("apply_observer_async_tgt");
    const desired = await cluster.createDb("apply_observer_async_desired");
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onRejection);
    try {
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer PRIMARY KEY);
      `);
      const [targetState, desiredState] = [
        await extract(target.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(targetState.factBase, desiredState.factBase);
      expect(thePlan.actions.length).toBeGreaterThan(0);

      const report = await apply(thePlan, target.pool, {
        fingerprintGate: false,
        onEvent: async () => {
          throw new Error("async observer boom");
        },
      });
      expect(report.status).toBe("applied");

      // give any escaped rejection a macrotask to reach the process handler
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
      await Promise.all([target.drop(), desired.drop()]);
    }
  }, 60_000);

  test("an observer that always throws never changes apply()'s outcome", async () => {
    const cluster = await sharedCluster();
    const targetA = await cluster.createDb("apply_observer_safe_a");
    const targetB = await cluster.createDb("apply_observer_safe_b");
    const desired = await cluster.createDb("apply_observer_safe_desired");
    try {
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer PRIMARY KEY, name text);
        CREATE INDEX t_name_idx ON app.t (name);
      `);
      const desiredState = await extract(desired.pool);

      const [stateA, stateB] = [
        await extract(targetA.pool),
        await extract(targetB.pool),
      ];
      const planA = plan(stateA.factBase, desiredState.factBase);
      const planB = plan(stateB.factBase, desiredState.factBase);

      const reportNoObserver = await apply(planA, targetA.pool, {
        fingerprintGate: false,
      });
      const reportThrowingObserver = await apply(planB, targetB.pool, {
        fingerprintGate: false,
        onEvent: () => {
          throw new Error("observer boom");
        },
      });

      expect(reportThrowingObserver.status).toBe(reportNoObserver.status);
      expect(reportThrowingObserver.appliedActions).toBe(
        reportNoObserver.appliedActions,
      );
      expect(reportThrowingObserver.actionStatuses).toEqual(
        reportNoObserver.actionStatuses,
      );
    } finally {
      await Promise.all([targetA.drop(), targetB.drop(), desired.drop()]);
    }
  }, 60_000);
});
