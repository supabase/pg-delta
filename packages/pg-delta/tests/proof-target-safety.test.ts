import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster } from "./containers.ts";

const SOURCE_DDL = `
  CREATE SCHEMA app;
  CREATE TABLE app.keep (id integer);
  CREATE TABLE app.remove_me (id integer);
`;

describe("proof target safety", () => {
  test("a stale clone fails before the plan can mutate it", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_guard_source");
    const desired = await cluster.createDb("proof_guard_desired");
    const clone = await cluster.createDb("proof_guard_stale_clone");
    try {
      await source.pool.query(SOURCE_DDL);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.keep (id integer);
      `);
      await clone.pool.query(
        `${SOURCE_DDL} CREATE TABLE app.drift (id integer);`,
      );

      const [sourceState, desiredState] = await Promise.all([
        extract(source.pool),
        extract(desired.pool),
      ]);
      const verdict = await provePlan(
        plan(sourceState.factBase, desiredState.factBase),
        clone.pool,
        desiredState.factBase,
      );

      expect(verdict.sourceStateViolation).toBeDefined();
      expect(
        await clone.pool.query(
          `SELECT to_regclass('app.remove_me') IS NOT NULL AS present`,
        ),
      ).toMatchObject({ rows: [{ present: true }] });
    } finally {
      await Promise.all([source.drop(), desired.drop(), clone.drop()]);
    }
  }, 60_000);

  test("a mismatched desired snapshot fails before the clone is mutated", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_guard_snapshot_source");
    const desired = await cluster.createDb("proof_guard_snapshot_desired");
    const wrongDesired = await cluster.createDb("proof_guard_snapshot_wrong");
    const clone = await cluster.createDb("proof_guard_snapshot_clone");
    try {
      await source.pool.query(SOURCE_DDL);
      await clone.pool.query(SOURCE_DDL);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.keep (id integer);
      `);
      await wrongDesired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.keep (id integer);
        CREATE TABLE app.unplanned (id integer);
      `);

      const [sourceState, desiredState, wrongDesiredState] = await Promise.all([
        extract(source.pool),
        extract(desired.pool),
        extract(wrongDesired.pool),
      ]);
      const verdict = await provePlan(
        plan(sourceState.factBase, desiredState.factBase),
        clone.pool,
        wrongDesiredState.factBase,
      );

      expect(verdict.desiredStateViolation).toBeDefined();
      expect(
        await clone.pool.query(
          `SELECT to_regclass('app.remove_me') IS NOT NULL AS present`,
        ),
      ).toMatchObject({ rows: [{ present: true }] });
    } finally {
      await Promise.all([
        source.drop(),
        desired.drop(),
        wrongDesired.drop(),
        clone.drop(),
      ]);
    }
  }, 60_000);

  test("undeclared table recreation fails before losing rows", async () => {
    const cluster = await sharedCluster();
    const clone = await cluster.createDb("proof_guard_metadata_clone");
    try {
      await clone.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer);
        INSERT INTO app.t VALUES (42);
      `);
      const state = await extract(clone.pool);
      const thePlan = plan(state.factBase, state.factBase);
      thePlan.actions.push({
        sql: `DROP TABLE app.t; CREATE TABLE app.t (id integer)`,
        verb: "alter",
        produces: [{ kind: "table", schema: "app", name: "t" }],
        consumes: [],
        destroys: [{ kind: "table", schema: "app", name: "t" }],
        releases: [],
        transactionality: "transactional",
        lockClass: "accessExclusive",
        newSegmentBefore: false,
        dataLoss: "none",
        rewriteRisk: false,
      });

      const verdict = await provePlan(thePlan, clone.pool, state.factBase);

      expect(verdict.safetyMetadataViolations).toEqual([
        {
          actionIndex: 0,
          table: { schema: "app", name: "t" },
        },
      ]);
      expect(await clone.pool.query(`SELECT * FROM app.t`)).toMatchObject({
        rows: [{ id: 42 }],
      });
    } finally {
      await clone.drop();
    }
  }, 60_000);

  test("an undeclared SQL-side drop fails the post-check even for an empty table", async () => {
    const cluster = await sharedCluster();
    const clone = await cluster.createDb("proof_guard_missing_clone");
    try {
      await clone.pool.query(`CREATE SCHEMA app; CREATE TABLE app.empty ();`);
      const state = await extract(clone.pool);
      const thePlan = plan(state.factBase, state.factBase);
      thePlan.actions.push({
        sql: `DROP TABLE app.empty`,
        verb: "drop",
        produces: [],
        consumes: [],
        destroys: [],
        releases: [],
        transactionality: "transactional",
        lockClass: "accessExclusive",
        newSegmentBefore: false,
        dataLoss: "none",
        rewriteRisk: false,
      });

      const verdict = await provePlan(thePlan, clone.pool, state.factBase);
      expect(verdict.ok).toBe(false);
      expect(verdict.dataViolations).toEqual([
        {
          table: { schema: "app", name: "empty" },
          before: 0,
          after: 0,
          missingAfter: true,
        },
      ]);
    } finally {
      await clone.drop();
    }
  }, 60_000);
});
