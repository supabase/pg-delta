/**
 * `provePlan({ autoSeed: true })` must report a per-table seed OUTCOME, not
 * silently swallow every insert failure. The taxonomy is by SQLSTATE class:
 *  - a class-23 integrity-constraint violation (NOT NULL without default, FK,
 *    unique, check) is an EXPECTED "unseedable" → outcome `skipped` with the
 *    SQLSTATE as `reasonCode`;
 *  - anything else (a raised exception, connection/syntax/permission error,
 *    unknown) is a genuine failure → outcome `failed` with the message.
 * A plainly-seedable table → outcome `seeded`.
 *
 * This pins the observability contract that the corpus seed-coverage gate
 * (tests/engine.test.ts + tests/autoseed-allowlist.ts) depends on.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan, type ProofVerdict } from "../src/proof/prove.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let db: TestDb;
let verdict: ProofVerdict;

beforeAll(async () => {
  db = await createTestDb("autoseed");
  await db.pool.query(`
    CREATE SCHEMA s;
    -- plainly seedable: every column is nullable or defaulted
    CREATE TABLE s.seedable (id serial PRIMARY KEY, note text);
    -- NOT NULL without a default → INSERT ... DEFAULT VALUES raises 23502
    CREATE TABLE s.notnull_nodefault (val integer NOT NULL);
    -- BEFORE INSERT trigger that RAISE EXCEPTION → SQLSTATE P0001 (class 'P')
    CREATE TABLE s.raiser (id integer);
    CREATE FUNCTION s.boom() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'seed blocked by trigger'; END $$;
    CREATE TRIGGER boom_before BEFORE INSERT ON s.raiser
      FOR EACH ROW EXECUTE FUNCTION s.boom();
    -- all columns defaulted/nullable, but a BEFORE INSERT trigger RETURNS NULL:
    -- the INSERT succeeds with rowCount 0, so NO row is stored — a false
    -- "seeded" unless the outcome is classified by rowCount ("no_row").
    CREATE TABLE s.trigger_suppressed (id integer);
    CREATE FUNCTION s.suppress() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NULL; END $$;
    CREATE TRIGGER suppress_before BEFORE INSERT ON s.trigger_suppressed
      FOR EACH ROW EXECUTE FUNCTION s.suppress();
  `);

  const { factBase } = await extract(db.pool);
  // trivial (empty) plan: autoSeed runs against the live pool, seeds the three
  // tables, and the no-op apply converges — the assertions are on seedOutcomes.
  const thePlan = plan(factBase, factBase);
  verdict = await provePlan(thePlan, db.pool, factBase, { autoSeed: true });
}, 120_000);

afterAll(async () => {
  await db.drop();
});

describe("provePlan autoSeed seed-outcome reporting", () => {
  function outcomeFor(name: string) {
    const outcomes = verdict.seedOutcomes ?? [];
    return outcomes.find(
      (o) => o.table.schema === "s" && o.table.name === name,
    );
  }

  test("surfaces a seedOutcomes array when autoSeed is set", () => {
    expect(verdict.seedOutcomes).toBeDefined();
  });

  test("a plainly-seedable table reports `seeded`", () => {
    expect(outcomeFor("seedable")).toEqual({
      table: { schema: "s", name: "seedable" },
      status: "seeded",
    });
  });

  test("a NOT NULL-without-default table reports `skipped` with SQLSTATE 23502", () => {
    expect(outcomeFor("notnull_nodefault")).toEqual({
      table: { schema: "s", name: "notnull_nodefault" },
      status: "skipped",
      reasonCode: "23502",
    });
  });

  test("a RAISE EXCEPTION trigger table reports `failed` (not skipped)", () => {
    const o = outcomeFor("raiser");
    expect(o?.status).toBe("failed");
    expect(o).toMatchObject({
      table: { schema: "s", name: "raiser" },
      status: "failed",
      reasonCode: "P0001",
    });
    expect((o as { message: string }).message).toMatch(/seed blocked/i);
  });

  test("a RETURNS NULL trigger (zero-row insert) reports `skipped` with reasonCode `no_row`", () => {
    // the INSERT succeeds but stores no row, so this is NOT `seeded` — classify
    // by rowCount and route it through the same allowlist gate as class-23.
    expect(outcomeFor("trigger_suppressed")).toEqual({
      table: { schema: "s", name: "trigger_suppressed" },
      status: "skipped",
      reasonCode: "no_row",
    });
  });
});
