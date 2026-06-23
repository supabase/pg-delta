/**
 * Bootstrap Supabase testcontainers with the dbdev-migrations fixture.
 * Used by compare-engines --fixture dbdev and run-dogfood-suite.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import pg from "pg";

const MIGRATIONS_DIR = join(
  new URL(
    "../../../pg-delta/tests/integration/fixtures/dbdev-migrations/migrations/",
    import.meta.url,
  ).pathname,
);

const SUPABASE_PG15_TAG = "15.14.1.107";

export type DbdevMigrationScope = "core" | "all";

/** Handle for apply-check / prove: independent copy of the source database state. */
export interface DbdevCloneSource {
  clone(): Promise<{ pool: Pool; drop(): Promise<void> }>;
}

export interface DbdevFixture {
  mainPool: Pool;
  branchPool: Pool;
  /** Clone main (supabase base-init only) for apply-check on roundtrip scenarios. */
  mainCloneSource: DbdevCloneSource;
  /** Clone branch (base-init + dbdev migrations) for apply-check on zero-diff. */
  branchCloneSource: DbdevCloneSource;
  mainUri: string;
  branchUri: string;
  migrationCount: number;
  cleanup: () => Promise<void>;
}

function suppressShutdownError(err: Error & { code?: string }) {
  if (err.code === "57P01" || err.code === "53100") return;
  console.error("Pool error:", err);
}

function createPostgresRolePool(connectionUri: string): Pool {
  const pool = new pg.Pool({ connectionString: connectionUri, max: 5 });
  pool.on("error", suppressShutdownError);
  pool.on("connect", (client) => {
    void client.query("SET ROLE postgres").catch(() => {});
  });
  return pool;
}

function createSetupPool(connectionUri: string): Pool {
  const pool = new pg.Pool({ connectionString: connectionUri, max: 5 });
  pool.on("error", suppressShutdownError);
  return pool;
}

async function loadMigrations(
  scope: DbdevMigrationScope,
): Promise<{ filename: string; sql: string }[]> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => (scope === "core" ? f.startsWith("20220117") : true))
    .sort();
  return Promise.all(
    files.map(async (filename) => ({
      filename,
      sql: await readFile(join(MIGRATIONS_DIR, filename), "utf-8"),
    })),
  );
}

function uriForDatabase(baseUri: string, dbName: string): string {
  return baseUri.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
}

function makeTemplateCloneSource(
  adminPool: Pool,
  getActivePool: () => Pool,
  setActivePool: (pool: Pool) => void,
  baseUri: string,
  templateDb = "postgres",
): DbdevCloneSource {
  let cloneCounter = 0;
  return {
    async clone() {
      await getActivePool().end();
      await adminPool.query(
        `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `,
        [templateDb],
      );
      const cloneName = `${templateDb}_clone_${cloneCounter++}`;
      const quotedClone = `"${cloneName.replaceAll('"', '""')}"`;
      await adminPool.query(
        `CREATE DATABASE ${quotedClone} TEMPLATE "${templateDb}"`,
      );
      await adminPool.query(`ALTER DATABASE ${quotedClone} OWNER TO postgres`);
      setActivePool(createPostgresRolePool(baseUri));

      const clonePool = createPostgresRolePool(
        uriForDatabase(baseUri, cloneName),
      );
      return {
        pool: clonePool,
        drop: async () => {
          await clonePool.end().catch(() => {});
          await adminPool.query(
            `DROP DATABASE IF EXISTS ${quotedClone} WITH (FORCE)`,
          );
        },
      };
    },
  };
}

type SupabaseContainer = {
  getConnectionUri(): string;
  stop(): Promise<void>;
};

type SupabaseContainerCtor = new (image: string) => {
  start(): Promise<SupabaseContainer>;
};

/** Fresh container with supabase base-init — required for main roundtrip apply-check
 *  because Supabase only allows CREATE EXTENSION in the `postgres` database. */
function makeFreshMainCloneSource(
  Container: SupabaseContainerCtor,
  image: string,
): DbdevCloneSource {
  return {
    async clone() {
      const container = await new Container(image).start();
      const uri = container.getConnectionUri();
      const setupPool = createSetupPool(uri);
      const pool = createPostgresRolePool(uri);
      try {
        await applySupabaseBaseInit(setupPool);
      } catch (err) {
        await Promise.all([
          setupPool.end().catch(() => {}),
          pool.end().catch(() => {}),
          container.stop().catch(() => {}),
        ]);
        throw err;
      }
      await setupPool.end().catch(() => {});
      return {
        pool,
        drop: async () => {
          await pool.end().catch(() => {});
          await container.stop().catch(() => {});
        },
      };
    },
  };
}

async function applySupabaseBaseInit(pool: Pool): Promise<void> {
  const utilsPath = new URL("../../../pg-delta/tests/utils.ts", import.meta.url)
    .href;
  const mod = (await import(utilsPath)) as {
    applySupabaseBaseInit: (pool: Pool, version: 15) => Promise<void>;
    waitForPool: (pool: Pool) => Promise<void>;
  };
  await mod.waitForPool(pool);
  await mod.applySupabaseBaseInit(pool, 15);
}

export async function bootstrapDbdevFixture(
  scope: DbdevMigrationScope = "all",
): Promise<DbdevFixture> {
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
  process.stderr.write(
    `[bootstrap-dbdev] starting two Supabase containers (${scope} migrations)…\n`,
  );

  const [containerMain, containerBranch] = await Promise.all([
    new SupabasePostgreSqlContainer(image).start(),
    new SupabasePostgreSqlContainer(image).start(),
  ]);

  const mainUri = containerMain.getConnectionUri();
  const branchUri = containerBranch.getConnectionUri();

  const setupMain = createSetupPool(mainUri);
  const setupBranch = createSetupPool(branchUri);
  const mainPool = createPostgresRolePool(mainUri);
  const branchPool = createPostgresRolePool(branchUri);

  try {
    await Promise.all([
      applySupabaseBaseInit(setupMain),
      applySupabaseBaseInit(setupBranch),
    ]);

    const migrations = await loadMigrations(scope);
    for (const { filename, sql } of migrations) {
      await branchPool.query(sql).catch((err) => {
        throw new Error(`Migration ${filename} failed: ${String(err)}`, {
          cause: err,
        });
      });
    }

    process.stderr.write(
      `[bootstrap-dbdev] applied ${migrations.length} migration(s) to branch\n`,
    );

    let activeBranchPool = branchPool;

    return {
      mainPool,
      get branchPool() {
        return activeBranchPool;
      },
      mainCloneSource: makeFreshMainCloneSource(
        SupabasePostgreSqlContainer,
        image,
      ),
      branchCloneSource: makeTemplateCloneSource(
        setupBranch,
        () => activeBranchPool,
        (pool) => {
          activeBranchPool = pool;
        },
        branchUri,
      ),
      mainUri,
      branchUri,
      migrationCount: migrations.length,
      cleanup: async () => {
        await Promise.all([
          setupMain.end().catch(() => {}),
          setupBranch.end().catch(() => {}),
          mainPool.end().catch(() => {}),
          activeBranchPool.end().catch(() => {}),
        ]);
        await Promise.all([containerMain.stop(), containerBranch.stop()]);
      },
    };
  } catch (err) {
    await Promise.all([
      setupMain.end().catch(() => {}),
      setupBranch.end().catch(() => {}),
      mainPool.end().catch(() => {}),
      branchPool.end().catch(() => {}),
      containerMain.stop().catch(() => {}),
      containerBranch.stop().catch(() => {}),
    ]);
    throw err;
  }
}

/** Apply dbdev migrations to a single pool that already has supabase base-init. */
export async function applyDbdevMigrations(
  pool: Pool,
  scope: DbdevMigrationScope = "all",
): Promise<number> {
  const migrations = await loadMigrations(scope);
  for (const { filename, sql } of migrations) {
    await pool.query(sql).catch((err) => {
      throw new Error(`Migration ${filename} failed: ${String(err)}`, {
        cause: err,
      });
    });
  }
  return migrations.length;
}

export { MIGRATIONS_DIR, SUPABASE_PG15_TAG };
