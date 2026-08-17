import { describe, expect, test } from "bun:test";
import {
  hasTransactionControl,
  isPipelineIncompatible,
  parseTransactionMode,
  planFileExecution,
} from "./runner-semantics.ts";

describe("parseTransactionMode", () => {
  test("honors an exact first-line pg-delta directive", () => {
    expect(
      parseTransactionMode("-- pg-delta: transaction=false\nVACUUM;"),
    ).toBe("none");
    expect(
      parseTransactionMode("\uFEFF-- pg-delta: transaction=false\r\nVACUUM;"),
    ).toBe("none");
  });

  test("ignores the directive anywhere but the first line", () => {
    expect(
      parseTransactionMode(
        "CREATE TABLE t (id int);\n-- pg-delta: transaction=false\n",
      ),
    ).toBe("transactional");
    expect(parseTransactionMode("-- pg-squash: no-transaction\nVACUUM;")).toBe(
      "transactional",
    );
  });
});

describe("hasTransactionControl", () => {
  test("treats BEGIN/COMMIT/ROLLBACK as control", () => {
    expect(hasTransactionControl("BEGIN;")).toBe(true);
    expect(hasTransactionControl("COMMIT")).toBe(true);
    expect(hasTransactionControl("ROLLBACK;")).toBe(true);
    expect(hasTransactionControl("START TRANSACTION")).toBe(true);
  });

  test("does not treat ROLLBACK TO as ending the transaction", () => {
    expect(hasTransactionControl("ROLLBACK TO sp;")).toBe(false);
    expect(hasTransactionControl("ROLLBACK TO SAVEPOINT sp;")).toBe(false);
    expect(hasTransactionControl("ROLLBACK WORK TO sp")).toBe(false);
  });
});

describe("isPipelineIncompatible", () => {
  test("matches the CLI CONCURRENTLY / VACUUM / CLUSTER set", () => {
    expect(
      isPipelineIncompatible(
        "CREATE UNIQUE INDEX CONCURRENTLY t_id ON t (id);",
      ),
    ).toBe(true);
    expect(isPipelineIncompatible("DROP INDEX CONCURRENTLY t_id;")).toBe(true);
    expect(
      isPipelineIncompatible("REFRESH MATERIALIZED VIEW CONCURRENTLY mv;"),
    ).toBe(true);
    expect(isPipelineIncompatible("REINDEX TABLE CONCURRENTLY t;")).toBe(true);
    expect(isPipelineIncompatible("VACUUM ANALYZE t;")).toBe(true);
    expect(isPipelineIncompatible("CLUSTER t;")).toBe(true);
    expect(
      isPipelineIncompatible("ALTER SYSTEM SET wal_level = logical;"),
    ).toBe(true);
    expect(isPipelineIncompatible("CREATE TABLE t (id int);")).toBe(false);
    expect(isPipelineIncompatible("CREATE INDEX t_id ON t (id);")).toBe(false);
  });

  test("ignores keywords inside leading comments", () => {
    expect(isPipelineIncompatible("-- VACUUM\nCREATE TABLE t (id int);")).toBe(
      false,
    );
  });
});

describe("planFileExecution", () => {
  test("wraps ordinary statements in one transaction batch", () => {
    const plan = planFileExecution("CREATE TABLE t (id int);", [
      "CREATE TABLE t (id int);",
    ]);
    expect(plan).toEqual({
      mode: "wrapped",
      batches: [{ kind: "txn", statements: ["CREATE TABLE t (id int);"] }],
    });
  });

  test("flushes pipeline-incompatible statements to run standalone", () => {
    const plan = planFileExecution("", [
      "CREATE TABLE t (id int);",
      "CREATE INDEX CONCURRENTLY t_id ON t (id);",
      "ANALYZE t;",
    ]);
    expect(plan.mode).toBe("wrapped");
    if (plan.mode !== "wrapped") return;
    expect(plan.batches).toEqual([
      { kind: "txn", statements: ["CREATE TABLE t (id int);"] },
      {
        kind: "standalone",
        sql: "CREATE INDEX CONCURRENTLY t_id ON t (id);",
      },
      { kind: "txn", statements: ["ANALYZE t;"] },
    ]);
  });

  test("skips wrapping for the pg-delta no-transaction directive", () => {
    const sql = "-- pg-delta: transaction=false\nVACUUM;";
    const plan = planFileExecution(sql, ["VACUUM;"]);
    expect(plan).toEqual({
      mode: "sequential",
      reason: "no-transaction",
      statements: ["VACUUM;"],
    });
  });

  test("skips wrapping when the file authors BEGIN/COMMIT", () => {
    const plan = planFileExecution("", [
      "BEGIN;",
      "CREATE TABLE t (id int);",
      "COMMIT;",
    ]);
    expect(plan).toEqual({
      mode: "sequential",
      reason: "authored-transaction",
      statements: ["BEGIN;", "CREATE TABLE t (id int);", "COMMIT;"],
    });
  });
});
