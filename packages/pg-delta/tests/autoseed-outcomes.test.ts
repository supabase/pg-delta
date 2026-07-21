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
let schemaChangeDb: TestDb;
let schemaChangeVerdict: ProofVerdict;
let seedSchemaDb: TestDb;
let seedSchemaVerdict: ProofVerdict;
let emptySeedSchemaDb: TestDb;
let emptySeedSchemaVerdict: ProofVerdict;

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
    -- "seeded" unless the outcome is classified by persisted state ("no_row").
    CREATE TABLE s.trigger_suppressed (id integer);
    CREATE FUNCTION s.suppress() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NULL; END $$;
    CREATE TRIGGER suppress_before BEFORE INSERT ON s.trigger_suppressed
      FOR EACH ROW EXECUTE FUNCTION s.suppress();
    -- all columns defaulted/nullable, but an AFTER INSERT trigger DELETEs the
    -- just-inserted row: PostgreSQL reports INSERT 0 1 (rowCount 1) while the
    -- table stays EMPTY — rowCount is the command tag, not persisted state.
    CREATE TABLE s.trigger_undone (id integer);
    CREATE FUNCTION s.undo() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN DELETE FROM s.trigger_undone; RETURN NULL; END $$;
    CREATE TRIGGER undo_after AFTER INSERT ON s.trigger_undone
      FOR EACH ROW EXECUTE FUNCTION s.undo();
    -- CROSS-TABLE undo: aaa_victim is seeded cleanly FIRST (tableStats orders
    -- candidates by schema, name, so aaa_ precedes zzz_), then seeding
    -- zzz_deleter fires an AFTER INSERT trigger that DELETEs aaa_victim's row.
    -- A per-insert existence probe would still call aaa_victim seeded; only
    -- reconciliation against the FINAL pre-apply snapshot catches it as no_row.
    CREATE TABLE s.aaa_victim (id integer);
    CREATE TABLE s.zzz_deleter (id integer);
    CREATE FUNCTION s.delete_victim() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN DELETE FROM s.aaa_victim; RETURN NULL; END $$;
    CREATE TRIGGER delete_victim_after AFTER INSERT ON s.zzz_deleter
      FOR EACH ROW EXECUTE FUNCTION s.delete_victim();
    -- PRE-EXISTING data must not become invisible just because autoSeed runs
    -- before the proof baseline. This table starts populated, so it is not a
    -- seed candidate; seeding the empty mutator below deletes its original row.
    CREATE TABLE s.populated_victim (id integer);
    INSERT INTO s.populated_victim VALUES (42);
    CREATE TABLE s.seed_side_effect (id integer);
    CREATE FUNCTION s.delete_populated_victim() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN DELETE FROM s.populated_victim; RETURN NULL; END $$;
    CREATE TRIGGER delete_populated_victim_after
      AFTER INSERT ON s.seed_side_effect
      FOR EACH ROW EXECUTE FUNCTION s.delete_populated_victim();
  `);

  const { factBase } = await extract(db.pool);
  // trivial (empty) plan: autoSeed runs against the live pool, seeds the three
  // tables, and the no-op apply converges — the assertions are on seedOutcomes.
  const thePlan = plan(factBase, factBase);
  verdict = await provePlan(thePlan, db.pool, factBase, { autoSeed: true });

  schemaChangeDb = await createTestDb("autoseed-schema-change");
  await schemaChangeDb.pool.query(`
    CREATE SCHEMA s;
    CREATE TABLE s.populated_victim (
      id integer PRIMARY KEY,
      value text NOT NULL
    );
    INSERT INTO s.populated_victim VALUES (1, 'original');
    CREATE TABLE s.seed_mutator (id integer);
    CREATE FUNCTION s.mutate_populated_victim() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE s.populated_victim SET value = 'mutated';
        RETURN NULL;
      END $$;
    CREATE TRIGGER mutate_populated_victim_after
      AFTER INSERT ON s.seed_mutator
      FOR EACH ROW EXECUTE FUNCTION s.mutate_populated_victim();
  `);

  const { factBase: schemaChangeSource } = await extract(schemaChangeDb.pool);
  await schemaChangeDb.pool.query(
    "ALTER TABLE s.populated_victim ADD COLUMN note text",
  );
  const { factBase: schemaChangeTarget } = await extract(schemaChangeDb.pool);
  await schemaChangeDb.pool.query(
    "ALTER TABLE s.populated_victim DROP COLUMN note",
  );

  schemaChangeVerdict = await provePlan(
    plan(schemaChangeSource, schemaChangeTarget),
    schemaChangeDb.pool,
    schemaChangeTarget,
    { autoSeed: true },
  );

  seedSchemaDb = await createTestDb("autoseed-trigger-schema-change");
  await seedSchemaDb.pool.query(`
    CREATE SCHEMA s;
    CREATE TABLE s.populated_victim (
      id integer PRIMARY KEY,
      value integer NOT NULL
    );
    INSERT INTO s.populated_victim VALUES (1, 10);
    CREATE TABLE s.seed_mutator (id integer);
    CREATE FUNCTION s.mutate_data_and_schema() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE s.populated_victim SET value = 11;
        ALTER TABLE s.populated_victim ALTER COLUMN value TYPE bigint;
        RETURN NULL;
      END $$;
    CREATE TRIGGER mutate_data_and_schema_after
      AFTER INSERT ON s.seed_mutator
      FOR EACH ROW EXECUTE FUNCTION s.mutate_data_and_schema();
  `);

  const { factBase: seedSchemaSource } = await extract(seedSchemaDb.pool);
  await seedSchemaDb.pool.query(
    "ALTER TABLE s.populated_victim ALTER COLUMN value TYPE bigint",
  );
  const { factBase: seedSchemaTarget } = await extract(seedSchemaDb.pool);
  await seedSchemaDb.pool.query(
    "ALTER TABLE s.populated_victim ALTER COLUMN value TYPE integer",
  );

  seedSchemaVerdict = await provePlan(
    plan(seedSchemaSource, seedSchemaTarget),
    seedSchemaDb.pool,
    seedSchemaTarget,
    { autoSeed: true },
  );

  emptySeedSchemaDb = await createTestDb("autoseed-empty-schema-change");
  await emptySeedSchemaDb.pool.query(`
    CREATE SCHEMA s;
    CREATE TABLE s.aaa_seed_mutator (id integer);
    CREATE TABLE s.zzz_empty_victim (value integer);
    CREATE FUNCTION s.mutate_empty_schema() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        ALTER TABLE s.zzz_empty_victim ALTER COLUMN value TYPE bigint;
        RETURN NULL;
      END $$;
    CREATE TRIGGER mutate_empty_schema_after
      AFTER INSERT ON s.aaa_seed_mutator
      FOR EACH ROW EXECUTE FUNCTION s.mutate_empty_schema();
  `);

  const { factBase: emptySeedSchemaSource } = await extract(
    emptySeedSchemaDb.pool,
  );
  await emptySeedSchemaDb.pool.query(
    "ALTER TABLE s.zzz_empty_victim ALTER COLUMN value TYPE bigint",
  );
  const { factBase: emptySeedSchemaTarget } = await extract(
    emptySeedSchemaDb.pool,
  );
  await emptySeedSchemaDb.pool.query(
    "ALTER TABLE s.zzz_empty_victim ALTER COLUMN value TYPE integer",
  );

  emptySeedSchemaVerdict = await provePlan(
    plan(emptySeedSchemaSource, emptySeedSchemaTarget),
    emptySeedSchemaDb.pool,
    emptySeedSchemaTarget,
    { autoSeed: true },
  );
}, 120_000);

afterAll(async () => {
  await db.drop();
  await schemaChangeDb.drop();
  await seedSchemaDb.drop();
  await emptySeedSchemaDb.drop();
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
    // by persisted state and route it through the same allowlist gate as class-23.
    expect(outcomeFor("trigger_suppressed")).toEqual({
      table: { schema: "s", name: "trigger_suppressed" },
      status: "skipped",
      reasonCode: "no_row",
    });
  });

  test("an AFTER INSERT trigger that DELETEs the row (rowCount 1, table empty) reports `skipped` with reasonCode `no_row`", () => {
    // rowCount is the command tag, not persisted state: `INSERT 0 1` but the
    // row was undone. Final-snapshot reconciliation catches this.
    expect(outcomeFor("trigger_undone")).toEqual({
      table: { schema: "s", name: "trigger_undone" },
      status: "skipped",
      reasonCode: "no_row",
    });
  });

  test("a CROSS-TABLE undo reclassifies an earlier-seeded table to `no_row`", () => {
    // aaa_victim seeded cleanly, then zzz_deleter's insert deletes its row: the
    // final pre-apply snapshot has aaa_victim empty, so it must be `no_row`
    // (a per-insert probe would have wrongly kept it `seeded`), while
    // zzz_deleter — whose own row persists — stays `seeded`.
    expect(outcomeFor("aaa_victim")).toEqual({
      table: { schema: "s", name: "aaa_victim" },
      status: "skipped",
      reasonCode: "no_row",
    });
    expect(outcomeFor("zzz_deleter")).toEqual({
      table: { schema: "s", name: "zzz_deleter" },
      status: "seeded",
    });
  });

  test("autoSeed side effects cannot erase pre-existing data before the proof baseline", () => {
    // populated_victim is excluded from autoSeed because it starts with one row.
    // Seeding seed_side_effect deletes that row; the proof must compare against
    // the pre-seed snapshot and report the loss instead of baselining it away.
    expect(verdict.dataViolations).toContainEqual({
      table: { schema: "s", name: "populated_victim" },
      before: 1,
      after: 0,
    });
    expect(verdict.ok).toBe(false);
  });

  test("detects equal-row-count autoSeed mutations before a schema-changing plan", () => {
    // The seed trigger changes only row content, then the plan changes that
    // table's schema. The final data-proof comparison cannot compare content
    // across schemas, so the mutation must be captured before the plan runs.
    expect(schemaChangeVerdict.dataViolations).toContainEqual({
      table: { schema: "s", name: "populated_victim" },
      before: 1,
      after: 1,
      contentChanged: true,
    });
    expect(schemaChangeVerdict.ok).toBe(false);
  });

  test("rejects schema changes performed by an autoSeed trigger", () => {
    // The trigger both mutates the existing row and performs the same type
    // change as the plan. State still converges and row count stays stable, but
    // the proof must fail because autoSeed changed a populated table's schema.
    expect(seedSchemaVerdict.ok).toBe(false);
    expect(seedSchemaVerdict.dataViolations).toContainEqual({
      table: { schema: "s", name: "populated_victim" },
      before: 1,
      after: 1,
      schemaChanged: true,
    });
  });

  test("rejects schema changes on originally-empty tables before applying the plan", () => {
    expect(emptySeedSchemaVerdict.ok).toBe(false);
    expect(emptySeedSchemaVerdict.dataViolations).toContainEqual({
      table: { schema: "s", name: "zzz_empty_victim" },
      before: 0,
      after: 1,
      schemaChanged: true,
    });
  });
});
