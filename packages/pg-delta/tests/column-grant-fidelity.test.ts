/**
 * Column-level ACLs (`pg_attribute.attacl`, e.g. `GRANT SELECT (col) ON t TO r`)
 * must be extracted and rendered. Before this, `attacl` was not extracted at all,
 * so a from-empty export silently dropped every column grant and two schemas that
 * differed only by column privileges hashed equal. This pins the export/round-trip
 * fidelity: the from-empty plan must emit the column-qualified GRANT.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildFactBase } from "../src/core/fact.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let db: TestDb;
let sql: string;

beforeAll(async () => {
  db = await createTestDb("col-grant");
  await db.pool.query(`
    DO $$ BEGIN CREATE ROLE colgrant_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA app;
    CREATE TABLE app.t (a int, b int);
    GRANT SELECT (a, b) ON TABLE app.t TO colgrant_reader;
    GRANT UPDATE (b) ON TABLE app.t TO colgrant_reader;
  `);
  const state = await extract(db.pool);
  // from-empty export: the plan that builds `state` from nothing must include
  // the column-qualified grants.
  sql = plan(buildFactBase([], []), state.factBase)
    .actions.map((a) => a.sql)
    .join("\n");
}, 120_000);

afterAll(async () => {
  await db.pool.query(`DROP ROLE IF EXISTS colgrant_reader`).catch(() => {});
  await db.drop();
});

describe("column-level grant export fidelity", () => {
  test("from-empty export emits the SELECT column grant", () => {
    expect(sql).toMatch(
      /GRANT[^;]*SELECT \("?a"?\)[^;]*ON TABLE "?app"?\."?t"?[^;]*TO "?colgrant_reader"?/,
    );
  });

  test("from-empty export emits the UPDATE (b) column grant", () => {
    expect(sql).toMatch(
      /GRANT[^;]*UPDATE \("?b"?\)[^;]*ON TABLE "?app"?\."?t"?[^;]*TO "?colgrant_reader"?/,
    );
  });
});
