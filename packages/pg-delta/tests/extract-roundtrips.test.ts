/**
 * Round-trip budget regression: extraction should probe the server's version
 * ONCE per run, not once per family that happens to need a version gate.
 *
 * Before the fix, `SHOW server_version` (extract.ts) and four independent
 * `current_setting('server_version_num')` probes (types.ts, publications.ts
 * x2, unmodeled.ts) each cost their own sequential round trip inside the same
 * REPEATABLE READ transaction — see `ExtractContext.serverVersion` /
 * `.serverVersionNum` / `.pgMajor` in scope.ts for the combined replacement.
 */
import { afterAll, describe, expect, test } from "bun:test";
import type pg from "pg";
import { extract } from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

/** Wrap every client checked out from `pool` for the duration of `fn`, counting
 *  queries whose SQL matches `/server_version/`. Restores `pool.connect` when
 *  done — measurement only, never touches the library. */
async function withServerVersionProbeCount<T>(
  pool: pg.Pool,
  fn: () => Promise<T>,
): Promise<{ result: T; count: number }> {
  let count = 0;
  const origConnect = pool.connect.bind(pool);
  (pool as { connect: unknown }).connect = async (...args: unknown[]) => {
    const client = await (
      origConnect as (...a: unknown[]) => Promise<pg.PoolClient>
    )(...args);
    const origQuery = client.query.bind(client) as (...a: unknown[]) => unknown;
    (client as { query: unknown }).query = (...qa: unknown[]) => {
      const sql = typeof qa[0] === "string" ? qa[0] : String(qa[0]);
      if (/server_version/.test(sql)) count++;
      return origQuery(...qa);
    };
    return client;
  };
  try {
    const result = await fn();
    return { result, count };
  } finally {
    (pool as { connect: unknown }).connect = origConnect;
  }
}

describe("extract() server-version probe count", () => {
  test("probes server_version exactly once per extraction", async () => {
    const db = await createTestDb("extract_roundtrips");
    dbs.push(db);

    const { count } = await withServerVersionProbeCount(db.pool, () =>
      extract(db.pool),
    );

    expect(count).toBe(1);
  }, 120_000);
});
