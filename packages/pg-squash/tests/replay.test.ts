import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { testClusterHandle } from "./containers.ts";
import { createDatabasePool } from "../src/shadow/index.ts";
import { replayChain } from "../src/replay/index.ts";
import type { DatabasePool, LeasedDatabase } from "../src/shadow/index.ts";

describe("replayChain", () => {
  let pool: DatabasePool;
  let lease: LeasedDatabase;

  beforeAll(async () => {
    const handle = await testClusterHandle();
    pool = createDatabasePool(handle, {
      baselineDatabase: "template0",
      size: 1,
    });
    lease = await pool.take();
  }, 60_000);

  afterAll(async () => {
    if (lease !== undefined) await pool.release(lease);
    await pool?.drain();
  }, 60_000);

  test("applies a two-file chain on a shared session", async () => {
    const result = await replayChain(lease.pool, [
      { name: "0001_create.sql", sql: "CREATE TABLE t (id int);" },
      { name: "0002_insert.sql", sql: "INSERT INTO t VALUES (1);" },
    ]);
    expect(result.ok).toBe(true);
    const count = await lease.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM t`,
    );
    expect(count.rows[0]?.n).toBe("1");
  });

  test("RESET ALL before each file clears session GUCs", async () => {
    const result = await replayChain(lease.pool, [
      {
        name: "0003_readonly.sql",
        sql: "SET default_transaction_read_only = on;",
      },
      {
        name: "0004_write.sql",
        sql: "CREATE TABLE after_reset (id int);",
      },
    ]);
    expect(result.ok).toBe(true);
  });

  test("runs CREATE INDEX CONCURRENTLY standalone after flushing the batch", async () => {
    const result = await replayChain(lease.pool, [
      {
        name: "0005_idx.sql",
        sql: "CREATE TABLE idxed (id int);\nCREATE INDEX CONCURRENTLY idxed_id ON idxed (id);",
      },
    ]);
    expect(result.ok).toBe(true);
  });

  test("honors -- pg-delta: transaction=false for VACUUM", async () => {
    const result = await replayChain(lease.pool, [
      {
        name: "0006_vacuum.sql",
        sql: "-- pg-delta: transaction=false\nVACUUM;",
      },
    ]);
    expect(result.ok).toBe(true);
  });

  test("captures SQLSTATE 25001 from authored BEGIN + CONCURRENTLY", async () => {
    const result = await replayChain(lease.pool, [
      {
        name: "0007_bad.sql",
        sql: "BEGIN;\nCREATE INDEX CONCURRENTLY boom ON t (id);\nCOMMIT;",
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.nonTransactional).toBe(true);
    expect(result.failure.sqlstate).toBe("25001");
    expect(result.failure.file).toBe("0007_bad.sql");
  });
});
