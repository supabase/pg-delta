import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  testClusterHandle,
  uniqueRoleName,
  withLedgerLock,
} from "./containers.ts";
import {
  checkpointLease,
  createDatabasePool,
  diffLedger,
  dropCheckpoint,
  ledgerDiffIsEmpty,
  qid,
  restoreFromCheckpoint,
  revertLedger,
  snapshotLedger,
  uniqueDatabaseName,
} from "../src/shadow/index.ts";
import type { ClusterHandle } from "../src/model/index.ts";
import type { DatabasePool } from "../src/shadow/index.ts";

describe("shadow cluster", () => {
  let handle: ClusterHandle;
  let pool: DatabasePool;

  beforeAll(async () => {
    handle = await testClusterHandle();
    pool = createDatabasePool(handle, {
      baselineDatabase: "template0",
      size: 1,
    });
  }, 60_000);

  afterAll(async () => {
    await pool?.drain();
  }, 60_000);

  test("probes a CREATEDB-capable ClusterHandle", () => {
    expect(handle.pgMajor).toBeGreaterThanOrEqual(14);
  });

  test("clones a database with CREATE DATABASE TEMPLATE", async () => {
    const source = await pool.take();
    try {
      await source.pool.query(`CREATE TABLE t (id int)`);
      await source.pool.query(`INSERT INTO t VALUES (1)`);
      await source.pool.end();
      const cloneName = uniqueDatabaseName("cl");
      await handle.createDatabase(cloneName, source.name);
      const clone = await handle.connect(cloneName);
      try {
        const res = await clone.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM t`,
        );
        expect(res.rows[0]?.n).toBe("1");
      } finally {
        await clone.end();
        await handle.dropDatabase(cloneName);
      }
      source.pool = await handle.connect(source.name);
    } finally {
      await pool.release(source);
    }
  });

  test("reverts CREATE ROLE via the cluster ledger", async () => {
    await withLedgerLock(async () => {
      const before = await snapshotLedger(handle.admin);
      const role = uniqueRoleName();
      await handle.admin.query(`CREATE ROLE ${qid(role)}`);
      const after = await snapshotLedger(handle.admin);
      const diff = diffLedger(before, after);
      expect(diff.createdRoles).toContain(role);
      expect(ledgerDiffIsEmpty(diff)).toBe(false);
      await revertLedger(handle.admin, before);
      const restored = await snapshotLedger(handle.admin);
      expect(restored.roles).not.toContain(role);
      expect(ledgerDiffIsEmpty(diffLedger(before, restored))).toBe(true);
    });
  });

  test("reverts GRANT membership and ALTER ROLE SET", async () => {
    await withLedgerLock(async () => {
      const role = uniqueRoleName();
      const member = uniqueRoleName("sq_mem");
      await handle.admin.query(`CREATE ROLE ${qid(role)}`);
      await handle.admin.query(`CREATE ROLE ${qid(member)}`);
      const before = await snapshotLedger(handle.admin);
      await handle.admin.query(`GRANT ${qid(role)} TO ${qid(member)}`);
      await handle.admin.query(
        `ALTER ROLE ${qid(role)} SET statement_timeout = 1234`,
      );
      await revertLedger(handle.admin, before);
      const restored = await snapshotLedger(handle.admin);
      expect(ledgerDiffIsEmpty(diffLedger(before, restored))).toBe(true);
      await handle.admin.query(`DROP ROLE ${qid(member)}`);
      await handle.admin.query(`DROP ROLE ${qid(role)}`);
    });
  });

  test("restores a checkpoint clone and ledger together", async () => {
    await withLedgerLock(async () => {
      const lease = await pool.take();
      await lease.pool.query(`CREATE TABLE kept (id int)`);
      const sealed = await checkpointLease(handle, lease);
      const role = uniqueRoleName();
      await handle.admin.query(`CREATE ROLE ${qid(role)}`);
      await sealed.lease.pool.query(`DROP TABLE kept`);
      const restored = await restoreFromCheckpoint(handle, sealed.checkpoint, {
        drop: sealed.lease,
      });
      try {
        const tables = await restored.pool.query<{ relname: string }>(
          `SELECT relname FROM pg_class WHERE relname = 'kept' AND relkind = 'r'`,
        );
        expect(tables.rows).toHaveLength(1);
        const roles = await snapshotLedger(handle.admin);
        expect(roles.roles).not.toContain(role);
      } finally {
        await pool.release(restored);
        await dropCheckpoint(handle, sealed.checkpoint);
      }
    });
  });
});
