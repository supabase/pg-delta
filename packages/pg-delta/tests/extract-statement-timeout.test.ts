/**
 * Milestone A — extraction statement-timeout budget. A runaway catalog query on
 * a pathological schema must fail with an actionable diagnostic that NAMES the
 * offending query, not an opaque `canceling statement due to statement timeout`
 * (or an indefinite hang). A tiny budget against a populated catalog is a
 * deterministic way to drive the path.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract, ExtractionTimeoutError } from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";

/** Enough objects that catalog queries (esp. the pg_depend resolver) take well
 *  over a 1ms server-side budget. */
function fixtureSql(): string {
  const parts: string[] = ["CREATE SCHEMA app;"];
  for (let i = 0; i < 25; i++) {
    parts.push(
      `CREATE TABLE app.t${i} (id integer PRIMARY KEY, v text DEFAULT 'x');`,
      `CREATE INDEX t${i}_v_idx ON app.t${i} (v);`,
      `CREATE VIEW app.vt${i} AS SELECT id, v FROM app.t${i};`,
    );
  }
  return parts.join("\n");
}

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb("extract-timeout");
  await db.pool.query(fixtureSql());
}, 120_000);

afterAll(async () => {
  await db.drop();
});

describe("extract: statement-timeout budget", () => {
  test("a 1ms budget fails with an actionable, query-naming error", async () => {
    let err: unknown;
    try {
      await extract(db.pool, { statementTimeoutMs: 1 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ExtractionTimeoutError);
    const timeout = err as ExtractionTimeoutError;
    expect(timeout.timeoutMs).toBe(1);
    // names which query blew the budget — actionable, not opaque
    expect(timeout.queryLabel.length).toBeGreaterThan(0);
    expect(timeout.diagnostic.code).toBe("extraction_timeout");
    expect(timeout.diagnostic.severity).toBe("error");
    expect(timeout.message).toContain(timeout.queryLabel);
  }, 60_000);

  test("no budget (default) extracts normally", async () => {
    const result = await extract(db.pool);
    expect(result.factBase.facts().length).toBeGreaterThan(0);
  }, 60_000);
});
