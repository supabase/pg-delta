/**
 * A composite type's attribute DROP is destructive when the type is in use.
 *
 * `ALTER TYPE … DROP ATTRIBUTE … CASCADE` nulls the stored value of that field
 * across every row of every table whose column is of the composite type — yet
 * the change carried no `dataLoss` flag, so the safety report called it
 * non-destructive and the renderer (which gates on `dataLoss`) emitted it with
 * no warning. The proof loop cannot catch this either: a composite attribute
 * change folds into `schemaSig`, degrading the content comparison to count-only
 * (an additive ADD ATTRIBUTE is genuinely lossless), so the `dataLoss` flag is
 * the ONLY protection.
 *
 * A collation-only attribute change routes through the attribute "replace"
 * strategy (drop + recreate the attribute), so it renders the SAME
 * `DROP ATTRIBUTE … CASCADE` and must be marked destructive too.
 *
 * Stock alpine image; Docker required.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let dropSrc: TestDb;
let dropDesired: TestDb;
let collSrc: TestDb;
let collDesired: TestDb;

beforeAll(async () => {
  dropSrc = await createTestDb("composite-dataloss-drop-src");
  dropDesired = await createTestDb("composite-dataloss-drop-desired");
  // source: composite (a, b) used by a POPULATED table column.
  await dropSrc.pool.query(`
    CREATE SCHEMA s;
    CREATE TYPE s.ct AS (a integer, b text);
    CREATE TABLE s.tbl (id integer PRIMARY KEY, c s.ct);
    INSERT INTO s.tbl VALUES (1, ROW(1, 'keep')), (2, ROW(2, 'drop'));
  `);
  // desired: attribute b removed — DROP ATTRIBUTE b CASCADE nulls s.tbl.c.b.
  await dropDesired.pool.query(`
    CREATE SCHEMA s;
    CREATE TYPE s.ct AS (a integer);
    CREATE TABLE s.tbl (id integer PRIMARY KEY, c s.ct);
  `);

  collSrc = await createTestDb("composite-dataloss-coll-src");
  collDesired = await createTestDb("composite-dataloss-coll-desired");
  // source: composite whose text attribute carries an explicit collation.
  await collSrc.pool.query(`
    CREATE SCHEMA s;
    CREATE TYPE s.ct AS (a integer, b text COLLATE "C");
    CREATE TABLE s.tbl (id integer PRIMARY KEY, c s.ct);
    INSERT INTO s.tbl VALUES (1, ROW(1, 'x'));
  `);
  // desired: collation-only change on attribute b → attribute "replace".
  await collDesired.pool.query(`
    CREATE SCHEMA s;
    CREATE TYPE s.ct AS (a integer, b text COLLATE "POSIX");
    CREATE TABLE s.tbl (id integer PRIMARY KEY, c s.ct);
  `);
}, 180_000);

afterAll(async () => {
  await Promise.all([
    dropSrc.drop(),
    dropDesired.drop(),
    collSrc.drop(),
    collDesired.drop(),
  ]);
});

describe("composite attribute drop is destructive when in use", () => {
  test("DROP ATTRIBUTE on an in-use composite is marked destructive", async () => {
    const [a, b] = [
      await extract(dropSrc.pool),
      await extract(dropDesired.pool),
    ];
    const p = plan(a.factBase, b.factBase);
    const dropAttr = p.actions.find((x) =>
      /ALTER TYPE .* DROP ATTRIBUTE/i.test(x.sql),
    );
    expect(dropAttr).toBeDefined();
    expect(dropAttr?.dataLoss).toBe("destructive");
    expect(p.safetyReport.destructiveActions).toBeGreaterThanOrEqual(1);
  });

  test("collation-only attribute change (replace) is marked destructive", async () => {
    const [a, b] = [
      await extract(collSrc.pool),
      await extract(collDesired.pool),
    ];
    const p = plan(a.factBase, b.factBase);
    const dropAttr = p.actions.find((x) =>
      /ALTER TYPE .* DROP ATTRIBUTE/i.test(x.sql),
    );
    expect(dropAttr).toBeDefined();
    expect(dropAttr?.dataLoss).toBe("destructive");
    expect(p.safetyReport.destructiveActions).toBeGreaterThanOrEqual(1);
  });
});
