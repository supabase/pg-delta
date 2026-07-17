/**
 * Extraction must not flood the diagnostic stream with dangling edges to
 * built-in (system-schema) objects — those bury real user-facing warnings
 * (review P1). A schema whose views/functions reference built-ins (count(),
 * upper(), pg_catalog types) should produce ZERO system dangling_edge
 * diagnostics, while still emitting the real user→user dependency edges.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract, type ExtractResult } from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let db: TestDb;
let result: ExtractResult;

beforeAll(async () => {
  db = await createTestDb("diag-noise");
  await db.pool.query(`
    CREATE SCHEMA app;
    CREATE TABLE app.t (id integer PRIMARY KEY, name text);
    -- view + function leaning on built-in functions/types (pg_catalog)
    CREATE VIEW app.summary AS
      SELECT count(*) AS n, max(upper(name)) AS hi FROM app.t;
    CREATE FUNCTION app.label(x integer) RETURNS text
      LANGUAGE sql STABLE AS 'SELECT upper(''row'' || x::text)';
  `);
  result = await extract(db.pool);
}, 120_000);

afterAll(async () => {
  await db.drop();
});

describe("extraction diagnostic noise (P1)", () => {
  test("no dangling_edge diagnostics for built-in / system-schema objects", () => {
    const systemDangling = result.diagnostics.filter(
      (d) =>
        d.code === "dangling_edge" &&
        /pg_catalog|information_schema|pg_toast|pg_temp/.test(d.message),
    );
    expect(systemDangling).toHaveLength(0);
  });

  test("real user→user dependency edges are still emitted", () => {
    const depends = result.factBase.edges.filter((e) => e.kind === "depends");
    // the view depends on the table's columns; that edge must survive
    expect(depends.length).toBeGreaterThan(0);
  });

  test("no dangling_edge diagnostics for built-in (pg_*) owner roles", () => {
    // The `public` schema is owned by the built-in role `pg_database_owner`
    // (PG14+), which extraction never emits as a role fact — so an owner edge
    // to it would always dangle. pushOwnerEdge now skips built-in owners
    // (isBuiltinRoleName), killing the recurring `role:pg_database_owner`
    // dangling_edge warning.
    const builtinRoleDangling = result.diagnostics.filter(
      (d) =>
        d.code === "dangling_edge" &&
        ((d.subject?.kind === "role" && d.subject.name.startsWith("pg_")) ||
          /-\[owner\]-> role:pg_/.test(d.message)),
    );
    expect(builtinRoleDangling).toHaveLength(0);
  });
});
