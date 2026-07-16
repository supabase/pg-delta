/**
 * A domain's `baseType`/`collation` attributes are "replace" (drop+create),
 * so any change drops and recreates the domain. A table COLUMN is not a
 * rebuildable kind, so if a surviving user column depends on the domain
 * PostgreSQL rejects the DROP at apply time ("cannot drop type … other
 * objects depend on it"). The planner must fail LOUD at plan time instead of
 * emitting a plan that crashes at apply — mirroring the in-use range-type
 * guard. Full in-place column migration for domains is tracked separately.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let dbA: TestDb;
let dbB: TestDb;

beforeAll(async () => {
  dbA = await createTestDb("domain-a");
  dbB = await createTestDb("domain-b");
  // A: domain over integer, used by a surviving table column.
  await dbA.pool.query(`
    CREATE SCHEMA app;
    CREATE DOMAIN app.d AS integer;
    CREATE TABLE app.bookings (id integer PRIMARY KEY, span app.d);
  `);
  // B: same names, but the domain's base type changed to bigint — a
  // "replace" of the domain while the app.bookings.span column still uses it.
  await dbB.pool.query(`
    CREATE SCHEMA app;
    CREATE DOMAIN app.d AS bigint;
    CREATE TABLE app.bookings (id integer PRIMARY KEY, span app.d);
  `);
}, 120_000);

afterAll(async () => {
  await Promise.all([dbA.drop(), dbB.drop()]);
});

describe("domain replace while in use", () => {
  test("throws a clear plan-time error when a surviving column depends on the domain", async () => {
    const [a, b] = [await extract(dbA.pool), await extract(dbB.pool)];
    expect(() => plan(a.factBase, b.factBase)).toThrow(
      /in-use domain|domain .* cannot .* replace|depend on it/i,
    );
  });
});
