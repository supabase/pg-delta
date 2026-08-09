/**
 * The single-`parentTable` payload captured for an inheriting table must be
 * DETERMINISTIC when a table has multiple inheritance parents. The extractor
 * captures one parent (multi-parent support is tracked separately), and the
 * `pg_inherits` subquery must `ORDER BY inhseqno` so the FIRST-declared parent
 * is always the one captured — otherwise the chosen parent flaps across
 * extractions and drives spurious table replaces.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract, type ExtractResult } from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let db: TestDb;
let result: ExtractResult;

beforeAll(async () => {
  db = await createTestDb("inh-parent");
  // The child inherits p_zeta FIRST (inhseqno = 1) then p_alpha (inhseqno = 2);
  // the declared order is intentionally the reverse of alphabetical so a naive
  // unordered LIMIT 1 has a chance to disagree with the first-declared parent.
  await db.pool.query(`
    CREATE SCHEMA app;
    CREATE TABLE app.p_zeta (z int);
    CREATE TABLE app.p_alpha (a int);
    CREATE TABLE app.child () INHERITS (app.p_zeta, app.p_alpha);
  `);
  result = await extract(db.pool);
}, 120_000);

afterAll(async () => {
  await db.drop();
});

describe("inheritance parent capture (multiple parents)", () => {
  test("captures the first-declared parent (inhseqno = 1) deterministically", () => {
    const child = result.factBase.get({
      kind: "table",
      schema: "app",
      name: "child",
    });
    expect(child?.payload["parentTable"]).toEqual({
      schema: "app",
      name: "p_zeta",
    });
  });
});
