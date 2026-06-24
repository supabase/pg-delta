/**
 * Bootstrap Supabase testcontainer with bookmark repo migrations applied.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import pg from "pg";

const BOOKMARK_MIGRATIONS = join(
  new URL("../../../../../bookmark/supabase/migrations/", import.meta.url)
    .pathname,
);

const SUPABASE_PG15_TAG = "15.14.1.107";

/** Handle for apply-check: independent copy of the baseline database state. */
export interface BookmarkCloneSource {
  clone(): Promise<{ pool: Pool; drop(): Promise<void> }>;
}

export interface BookmarkFixture {
  adminPool: Pool;
  baselinePool: Pool;
  baselineUri: string;
  /** Clone the baseline (`postgres` + bookmark migrations) for apply-check. */
  baselineCloneSource: BookmarkCloneSource;
  createMutatedDb: (
    sql: string,
  ) => Promise<{ pool: Pool; uri: string; drop: () => Promise<void> }>;
  cleanup: () => Promise<void>;
}

function uriForDatabase(baseUri: string, dbName: string): string {
  return baseUri.replace(/\/postgres(\?|$)/, `/${dbName}$1`);
}

function createPostgresRolePool(connectionUri: string): Pool {
  const pool = new pg.Pool({ connectionString: connectionUri, max: 5 });
  pool.on("error", () => {});
  pool.on("connect", (client) => {
    void client.query("SET ROLE postgres").catch(() => {});
  });
  return pool;
}

async function loadBookmarkMigrations(): Promise<
  { filename: string; sql: string }[]
> {
  const files = (await readdir(BOOKMARK_MIGRATIONS))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return Promise.all(
    files.map(async (filename) => ({
      filename,
      sql: await readFile(join(BOOKMARK_MIGRATIONS, filename), "utf-8"),
    })),
  );
}

async function applyMigrations(pool: Pool): Promise<void> {
  const migrations = await loadBookmarkMigrations();
  for (const { filename, sql } of migrations) {
    await pool.query(sql).catch((err) => {
      throw new Error(`Bookmark migration ${filename} failed: ${String(err)}`, {
        cause: err,
      });
    });
  }
}

export async function bootstrapBookmarkFixture(): Promise<BookmarkFixture> {
  const containerPath = new URL(
    "../../../pg-delta/tests/supabase-postgres.ts",
    import.meta.url,
  ).href;
  const { SupabasePostgreSqlContainer } = (await import(containerPath)) as {
    SupabasePostgreSqlContainer: new (image: string) => {
      start(): Promise<{
        getConnectionUri(): string;
        stop(): Promise<void>;
      }>;
    };
  };

  const image = `supabase/postgres:${SUPABASE_PG15_TAG}`;
  process.stderr.write("[bootstrap-bookmark] starting Supabase container…\n");

  const container = await new SupabasePostgreSqlContainer(image).start();
  const uri = container.getConnectionUri();
  const setupPool = new pg.Pool({ connectionString: uri, max: 3 });
  setupPool.on("error", () => {});

  const utilsPath = new URL("../../../pg-delta/tests/utils.ts", import.meta.url)
    .href;
  const { applySupabaseBaseInit, waitForPool } = (await import(utilsPath)) as {
    applySupabaseBaseInit: (pool: Pool, version: 15) => Promise<void>;
    waitForPool: (pool: Pool) => Promise<void>;
  };

  await waitForPool(setupPool);
  await applySupabaseBaseInit(setupPool, 15);

  const baselinePool = createPostgresRolePool(uri);
  await applyMigrations(baselinePool);

  process.stderr.write("[bootstrap-bookmark] migrations applied\n");

  let dbCounter = 0;
  let cloneCounter = 0;
  let activeBaselinePool = baselinePool;

  /** Copy the `postgres` baseline into a fresh database. `CREATE DATABASE …
   *  TEMPLATE postgres` requires NO sessions in the template, so we end the
   *  active baseline pool and issue the statement from a one-shot client on
   *  `template1` — that way the issuing session is never itself in `postgres`
   *  (avoiding the "source database is being accessed by other users" race when
   *  apply-check clones interleave with createMutatedDb), and a blanket
   *  terminate clears every other `postgres` backend. The active baseline pool
   *  is recreated lazily afterwards. */
  const createDbFromBaseline = async (targetName: string): Promise<void> => {
    await activeBaselinePool.end();
    const admin = new pg.Client({
      connectionString: uriForDatabase(uri, "template1"),
    });
    await admin.connect();
    try {
      await admin.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = 'postgres' AND pid <> pg_backend_pid()
      `);
      await admin.query(`CREATE DATABASE "${targetName}" TEMPLATE postgres`);
    } finally {
      await admin.end().catch(() => {});
    }
    activeBaselinePool = createPostgresRolePool(uri);
  };

  const cloneFromBaseline = async (): Promise<{
    pool: Pool;
    drop(): Promise<void>;
  }> => {
    const cloneName = `bookmark_clone_${cloneCounter++}`;
    await createDbFromBaseline(cloneName);
    const clonePool = createPostgresRolePool(uriForDatabase(uri, cloneName));
    return {
      pool: clonePool,
      drop: async () => {
        await clonePool.end().catch(() => {});
        await setupPool.query(
          `DROP DATABASE IF EXISTS "${cloneName}" WITH (FORCE)`,
        );
      },
    };
  };

  return {
    adminPool: setupPool,
    get baselinePool() {
      return activeBaselinePool;
    },
    baselineUri: uri,
    baselineCloneSource: { clone: cloneFromBaseline },
    createMutatedDb: async (mutationSql: string) => {
      const dbName = `bookmark_mut_${dbCounter++}`;
      await createDbFromBaseline(dbName);
      const dbUri = uriForDatabase(uri, dbName);
      const pool = createPostgresRolePool(dbUri);
      await pool.query(mutationSql);
      return {
        pool,
        uri: dbUri,
        drop: async () => {
          await pool.end().catch(() => {});
          await setupPool.query(
            `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
          );
        },
      };
    },
    cleanup: async () => {
      await Promise.all([
        setupPool.end().catch(() => {}),
        activeBaselinePool.end().catch(() => {}),
      ]);
      await container.stop();
    },
  };
}
