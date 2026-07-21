/**
 * Removing or reordering enum values rebuilds the type: rename the old enum
 * aside, create the new value set, migrate COLUMN dependents through a text
 * cast, then DROP the renamed old type. Only column dependents are migrated —
 * a DOMAIN over the enum, a COMPOSITE attribute using it, or a RANGE over it is
 * NOT rebuildable and stays bound to the renamed old type, so the final
 * DROP TYPE fails at apply. The planner must fail LOUD at plan time instead of
 * emitting a plan that crashes at apply — mirroring the in-use domain / range /
 * composite ALTER ATTRIBUTE guards. Full migration of such dependents is
 * tracked separately.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let domainA: TestDb;
let domainB: TestDb;
let compositeA: TestDb;
let compositeB: TestDb;

beforeAll(async () => {
  domainA = await createTestDb("enum-dom-a");
  domainB = await createTestDb("enum-dom-b");
  compositeA = await createTestDb("enum-comp-a");
  compositeB = await createTestDb("enum-comp-b");

  // domain over the enum, surviving on both sides; the enum drops a value.
  await domainA.pool.query(`
    CREATE SCHEMA app;
    CREATE TYPE app.color AS ENUM ('r', 'g', 'b');
    CREATE DOMAIN app.cd AS app.color;
  `);
  await domainB.pool.query(`
    CREATE SCHEMA app;
    CREATE TYPE app.color AS ENUM ('r', 'g');
    CREATE DOMAIN app.cd AS app.color;
  `);

  // composite attribute of the enum, surviving on both sides.
  await compositeA.pool.query(`
    CREATE SCHEMA app;
    CREATE TYPE app.color AS ENUM ('r', 'g', 'b');
    CREATE TYPE app.ct AS (c app.color, note text);
  `);
  await compositeB.pool.query(`
    CREATE SCHEMA app;
    CREATE TYPE app.color AS ENUM ('r', 'g');
    CREATE TYPE app.ct AS (c app.color, note text);
  `);
}, 120_000);

afterAll(async () => {
  await Promise.all([
    domainA.drop(),
    domainB.drop(),
    compositeA.drop(),
    compositeB.drop(),
  ]);
});

describe("enum value-set rebuild with non-column dependents", () => {
  test("throws a clear plan-time error when a surviving DOMAIN depends on the enum", async () => {
    const [a, b] = [await extract(domainA.pool), await extract(domainB.pool)];
    expect(() => plan(a.factBase, b.factBase)).toThrow(
      /depend on it|non-column|DOMAIN|cannot .* enum/i,
    );
  });

  test("throws a clear plan-time error when a surviving COMPOSITE attribute depends on the enum", async () => {
    const [a, b] = [
      await extract(compositeA.pool),
      await extract(compositeB.pool),
    ];
    expect(() => plan(a.factBase, b.factBase)).toThrow(
      /depend on it|non-column|COMPOSITE|TYPE|cannot .* enum/i,
    );
  });
});
