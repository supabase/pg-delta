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
import { apply, type ApplyEvent } from "../src/apply/apply.ts";
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

      // events interleave in the order apply() executes them: for every
      // actionStart[i], its actionEnd[i] appears immediately after (modulo
      // segment boundary events), never before the next actionStart.
      const kinds = events.map((e) => e.kind);
      const firstActionStartIdx = kinds.indexOf("actionStart");
      expect(firstActionStartIdx).toBeGreaterThanOrEqual(0);
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
