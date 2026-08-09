/**
 * A range type whose attributes change is drop+create (`replace`). A table
 * COLUMN is not a rebuildable kind, so if a surviving user column depends on the
 * range type PostgreSQL rejects the DROP at apply time ("cannot drop type … other
 * objects depend on it"). The planner must fail LOUD at plan time instead of
 * emitting a plan that crashes at apply — mirroring the in-use composite
 * ALTER ATTRIBUTE guard. Full in-place column migration for range types is
 * tracked separately.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let dbA: TestDb;
let dbB: TestDb;

beforeAll(async () => {
  dbA = await createTestDb("range-a");
  dbB = await createTestDb("range-b");
  // A: range over int4, used by a surviving table column.
  await dbA.pool.query(`
    CREATE SCHEMA app;
    CREATE TYPE app.r AS RANGE (subtype = int4);
    CREATE TABLE app.bookings (id integer PRIMARY KEY, span app.r);
  `);
  // B: same names, but the range subtype changed to int8 — a "replace" of the
  // range type while the app.bookings.span column still uses it.
  await dbB.pool.query(`
    CREATE SCHEMA app;
    CREATE TYPE app.r AS RANGE (subtype = int8);
    CREATE TABLE app.bookings (id integer PRIMARY KEY, span app.r);
  `);
}, 120_000);

afterAll(async () => {
  await Promise.all([dbA.drop(), dbB.drop()]);
});

describe("range type replace while in use", () => {
  test("throws a clear plan-time error when a surviving column depends on the range type", async () => {
    const [a, b] = [await extract(dbA.pool), await extract(dbB.pool)];
    expect(() => plan(a.factBase, b.factBase)).toThrow(
      /in-use range type|range type .* cannot .* replace|depend on it/i,
    );
  });
});
