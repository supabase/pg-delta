import type { Pool } from "pg";
import type { ClusterHandle } from "../model/index.ts";
import { uniqueDatabaseName } from "./names.ts";

export type LeasedDatabase = {
  name: string;
  pool: Pool;
};

export type DatabasePool = {
  take(): Promise<LeasedDatabase>;
  release(lease: LeasedDatabase): Promise<void>;
  drain(): Promise<void>;
};

export type CreateDatabasePoolOptions = {
  /** Template used for `CREATE DATABASE … TEMPLATE`. Must have zero backends. */
  baselineDatabase: string;
  /** Idle clones to keep warm. Default 2. */
  size?: number;
};

/**
 * Warm pool of databases cloned from `baselineDatabase`. Taking a clone is
 * O(1) when the idle list is populated; replenish runs in the background.
 */
export const createDatabasePool = (
  handle: ClusterHandle,
  options: CreateDatabasePoolOptions,
): DatabasePool => {
  const size = options.size ?? 2;
  const idle: LeasedDatabase[] = [];
  let closed = false;
  let replenishInflight = 0;
  const replenishJobs = new Set<Promise<void>>();

  const clone = async (): Promise<LeasedDatabase> => {
    const name = uniqueDatabaseName("wp");
    await handle.createDatabase(name, options.baselineDatabase);
    const pool = await handle.connect(name);
    return { name, pool };
  };

  const releaseDb = async (lease: LeasedDatabase): Promise<void> => {
    await lease.pool.end().catch(() => {});
    await handle.dropDatabase(lease.name);
  };

  const replenish = (): void => {
    while (!closed && idle.length + replenishInflight < size) {
      replenishInflight += 1;
      const job = (async () => {
        try {
          const db = await clone();
          replenishInflight -= 1;
          if (closed) {
            await releaseDb(db);
            return;
          }
          idle.push(db);
        } catch {
          replenishInflight -= 1;
        }
      })();
      replenishJobs.add(job);
      void job.finally(() => {
        replenishJobs.delete(job);
      });
    }
  };

  replenish();

  return {
    async take() {
      if (closed) {
        throw new Error("DatabasePool has been drained");
      }
      const hit = idle.pop();
      replenish();
      if (hit !== undefined) return hit;
      return clone();
    },
    async release(lease) {
      await releaseDb(lease);
    },
    async drain() {
      closed = true;
      await Promise.all(replenishJobs);
      const leftover = idle.splice(0);
      await Promise.all(leftover.map((db) => releaseDb(db)));
    },
  };
};
