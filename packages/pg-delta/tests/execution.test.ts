/**
 * Stage 6 integration suite: segmented execution, mid-plan failure
 * reporting, the fingerprint gate, artifact round-trip through a real
 * apply, CREATE INDEX CONCURRENTLY, and render-from-fact-base
 * materialization.
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import {
  computePlanId,
  parsePlan,
  serializePlan,
} from "../src/plan/artifact.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster } from "./containers.ts";

describe("stage 6: execution", () => {
  test("mid-plan failure reports applied/unapplied per action", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("exec_fail");
    try {
      // build a plan, then sabotage a mid-plan action so a later segment
      // boundary has already committed segment 1
      const desired = await cluster.createDb("exec_fail_desired");
      try {
        await desired.pool.query(`
          CREATE SCHEMA app;
          CREATE TYPE app.status AS ENUM ('a');
          CREATE TABLE app.t (id integer);
        `);
        const [sourceState, desiredState] = [
          await extract(db.pool),
          await extract(desired.pool),
        ];
        const thePlan = plan(sourceState.factBase, desiredState.factBase);
        // sabotage the LAST action; everything before it is one segment
        const last = thePlan.actions.length - 1;
        thePlan.actions[last]!.sql = "SELECT 1/0";
        thePlan.planId = computePlanId(thePlan); // re-stamp the sabotage past apply's planId gate
        const report = await apply(thePlan, db.pool, {
          fingerprintGate: false,
        });
        expect(report.status).toBe("failed");
        expect(report.error?.actionIndex).toBe(last);
        // single transactional segment → everything rolled back
        expect(report.actionStatuses.every((s) => s === "unapplied")).toBe(
          true,
        );
        expect(report.appliedActions).toBe(0);
      } finally {
        await desired.drop();
      }
    } finally {
      await db.drop();
    }
  }, 60_000);

  test("a failure after a committed segment leaves earlier actions applied", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_seg_src");
    const desired = await cluster.createDb("exec_seg_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.status AS ENUM ('a');
        CREATE TABLE app.t (s app.status);
      `);
      // adding a value AND a view that uses it forces a commit boundary
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.status AS ENUM ('a', 'b');
        CREATE TABLE app.t (s app.status);
        CREATE VIEW app.v AS SELECT s FROM app.t WHERE s = 'b';
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase);
      const boundaryPos = thePlan.actions.findIndex((a) => a.newSegmentBefore);
      expect(boundaryPos).toBeGreaterThan(0);
      // sabotage an action AFTER the boundary: segment 1 must stay applied
      thePlan.actions[boundaryPos]!.sql = "SELECT 1/0";
      thePlan.planId = computePlanId(thePlan); // re-stamp the sabotage past apply's planId gate
      const report = await apply(thePlan, source.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("failed");
      expect(
        report.actionStatuses
          .slice(0, boundaryPos)
          .every((s) => s === "applied"),
      ).toBe(true);
      expect(
        report.actionStatuses
          .slice(boundaryPos)
          .every((s) => s === "unapplied"),
      ).toBe(true);
      expect(report.appliedActions).toBe(boundaryPos);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("fingerprint gate refuses a stale plan", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_gate_src");
    const desired = await cluster.createDb("exec_gate_dst");
    try {
      await desired.pool.query(`CREATE SCHEMA app`);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase);
      // mutate the target AFTER planning: the gate must refuse
      await source.pool.query(`CREATE SCHEMA sneaky`);
      expect(apply(thePlan, source.pool)).rejects.toThrow(
        /fingerprint gate failed/,
      );
      // un-mutate; the gate passes and the plan applies
      await source.pool.query(`DROP SCHEMA sneaky`);
      const report = await apply(thePlan, source.pool);
      expect(report.status).toBe("applied");
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("plans survive artifact serialization and apply from the parsed form", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_art_src");
    const desired = await cluster.createDb("exec_art_dst");
    try {
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE SEQUENCE app.seq START 42;
        CREATE TABLE app.t (id bigint DEFAULT nextval('app.seq'));
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase);
      const reparsed = parsePlan(serializePlan(thePlan));
      expect(reparsed).toEqual(thePlan);
      const verdict = await provePlan(
        reparsed,
        source.pool,
        desiredState.factBase,
      );
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("concurrentIndexes param emits CREATE INDEX CONCURRENTLY outside transactions", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_cic_src");
    const desired = await cluster.createDb("exec_cic_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, x text);
        INSERT INTO app.t SELECT i, i::text FROM generate_series(1, 50) i;
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, x text);
        CREATE INDEX t_x_idx ON app.t (x);
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase, {
        params: { concurrentIndexes: true },
      });
      const indexAction = thePlan.actions.find((a) =>
        a.sql.includes("INDEX CONCURRENTLY"),
      );
      expect(indexAction?.transactionality).toBe("nonTransactional");
      expect(indexAction?.lockClass).toBe("shareUpdateExclusive");
      const report = await apply(thePlan, source.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      // the state converges to the SAME fact base as a plain CREATE INDEX
      const proven = await extract(source.pool);
      expect(proven.factBase.rootHash).toBe(desiredState.factBase.rootHash);
      // and the seeded rows survived
      const rows = await source.pool.query(
        `SELECT count(*)::int AS n FROM app.t`,
      );
      expect((rows.rows[0] as { n: number }).n).toBe(50);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("concurrentIndexes leaves a partitioned parent index non-concurrent (PG rejects CONCURRENTLY there)", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_cic_part_src");
    const desired = await cluster.createDb("exec_cic_part_dst");
    try {
      const seed = `
        CREATE SCHEMA app;
        CREATE TABLE app.p (id integer, ts date) PARTITION BY RANGE (ts);
        CREATE TABLE app.p_2024 PARTITION OF app.p
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        INSERT INTO app.p
          SELECT i, DATE '2024-01-01' + i FROM generate_series(1, 50) i;
      `;
      await source.pool.query(seed);
      await desired.pool.query(`${seed}
        CREATE INDEX p_ts_idx ON app.p (ts);
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase, {
        params: { concurrentIndexes: true },
      });
      // PostgreSQL rejects CREATE INDEX CONCURRENTLY on a partitioned table's
      // parent index (relkind='p'), so that create must stay plain.
      const parentIndexAction = thePlan.actions.find((a) =>
        a.sql.includes("p_ts_idx"),
      );
      expect(parentIndexAction?.sql).not.toContain("CONCURRENTLY");
      const report = await apply(thePlan, source.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      // converges to the same fact base as the direct CREATE INDEX
      const proven = await extract(source.pool);
      expect(proven.factBase.rootHash).toBe(desiredState.factBase.rootHash);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("unknown serialize parameters are a plan-time error", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("exec_param");
    try {
      const state = await extract(db.pool);
      expect(() =>
        plan(state.factBase, state.factBase, { params: { typo: true } }),
      ).toThrow(/unknown serialize parameter 'typo'/);
    } finally {
      await db.drop();
    }
  }, 60_000);

  test("render-from-fact-base materialization: extract -> plan from scratch -> hash-identical", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_mat_src");
    const scratch = await cluster.createDb("exec_mat_scratch");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.level AS ENUM ('low', 'high');
        CREATE TABLE app.t (
          id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          lvl app.level DEFAULT 'low',
          note text
        );
        CREATE INDEX t_note_idx ON app.t (note);
        CREATE VIEW app.v AS SELECT id, lvl FROM app.t;
        COMMENT ON TABLE app.t IS 'materialization target';
      `);
      const sourceState = await extract(source.pool);
      // the §3.7 second materialization form: re-create the MODEL of the
      // source on an empty scratch (template cloning unavailable on live
      // sources). "Empty" includes the platform defaults the scratch
      // already carries, so the plan starts from the scratch's own state.
      const scratchState = await extract(scratch.pool);
      const thePlan = plan(scratchState.factBase, sourceState.factBase);
      const report = await apply(thePlan, scratch.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      const materialized = await extract(scratch.pool);
      expect(materialized.factBase.rootHash).toBe(
        sourceState.factBase.rootHash,
      );
    } finally {
      await Promise.all([source.drop(), scratch.drop()]);
    }
  }, 60_000);
});
