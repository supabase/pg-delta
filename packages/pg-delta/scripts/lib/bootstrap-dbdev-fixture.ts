/**
 * Bootstrap Supabase testcontainers with the dbdev-migrations fixture.
 * Used by tests/dbdev-roundtrip.test.ts.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import pg from "pg";
import { startStandaloneSupabase } from "../../tests/containers.ts";
import { applySupabaseBaseInit as replaySupabaseBaseInit } from "../../tests/supabase-base-init.ts";

const MIGRATIONS_DIR = new URL(
  "../../tests/fixtures/dbdev-migrations/migrations/",
  import.meta.url,
).pathname;

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
  /** Ephemeral DB on the main container for declarative shadow loading. */
  createMainShadowDb: (
    prefix: string,
  ) => Promise<{ pool: Pool; drop(): Promise<void> }>;
  /** End main pools so CREATE DATABASE … TEMPLATE postgres can run. */
  prepareDeclarativeShadow: () => Promise<void>;
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
  getAdminPool: () => Pool,
  setAdminPool: (pool: Pool) => void,
  getActivePool: () => Pool,
  setActivePool: (pool: Pool) => void,
  baseUri: string,
  templateDb = "postgres",
): DbdevCloneSource {
  let cloneCounter = 0;
  return {
    async clone() {
      await getActivePool().end();
      await getAdminPool().end();
      const cloneName = `${templateDb}_clone_${cloneCounter++}`;
      const quotedClone = `"${cloneName.replaceAll('"', '""')}"`;
      const quotedTemplate = `"${templateDb.replaceAll('"', '""')}"`;
      const admin = new pg.Client({
        connectionString: uriForDatabase(baseUri, "template1"),
      });
      await admin.connect();
      try {
        await admin.query(
          `
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()
        `,
          [templateDb],
        );
        await admin.query(
          `CREATE DATABASE ${quotedClone} TEMPLATE ${quotedTemplate}`,
        );
        await admin.query(`ALTER DATABASE ${quotedClone} OWNER TO postgres`);
      } finally {
        await admin.end().catch(() => {});
      }
      const adminPool = createSetupPool(baseUri);
      setAdminPool(adminPool);
      setActivePool(createPostgresRolePool(baseUri));

      const clonePool = createPostgresRolePool(
        uriForDatabase(baseUri, cloneName),
      );
      return {
        pool: clonePool,
        drop: async () => {
          await clonePool.end().catch(() => {});
          await adminPool
            .query(`DROP DATABASE IF EXISTS ${quotedClone} WITH (FORCE)`)
            .catch(() => {});
        },
      };
    },
  };
}

/** Fresh container with supabase base-init — required for main roundtrip apply-check
 *  because Supabase only allows CREATE EXTENSION in the `postgres` database. */
function makeFreshMainCloneSource(): DbdevCloneSource {
  return {
    async clone() {
      const container = await startStandaloneSupabase();
      const uri = container.connectionUri();
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

async function waitForPool(pool: Pool): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Supabase container pool did not become ready");
}

async function applySupabaseBaseInit(pool: Pool): Promise<void> {
  await waitForPool(pool);
  await replaySupabaseBaseInit(pool);
}

export async function bootstrapDbdevFixture(
  scope: DbdevMigrationScope = "all",
): Promise<DbdevFixture> {
  process.stderr.write(
    `[bootstrap-dbdev] starting two Supabase containers (${scope} migrations)…\n`,
  );

  const [containerMain, containerBranch] = await Promise.all([
    startStandaloneSupabase(),
    startStandaloneSupabase(),
  ]);

  const mainUri = containerMain.connectionUri();
  const branchUri = containerBranch.connectionUri();

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
    let activeMainPool = mainPool;
    let activeSetupMain = setupMain;
    let activeSetupBranch = setupBranch;

    return {
      get mainPool() {
        return activeMainPool;
      },
      get branchPool() {
        return activeBranchPool;
      },
      mainCloneSource: makeFreshMainCloneSource(),
      branchCloneSource: makeTemplateCloneSource(
        () => activeSetupBranch,
        (pool) => {
          activeSetupBranch = pool;
        },
        () => activeBranchPool,
        (pool) => {
          activeBranchPool = pool;
        },
        branchUri,
      ),
      createMainShadowDb: async (prefix) => {
        const dbName = `shadow_${prefix}_${Date.now()}`.replace(
          /[^a-zA-Z0-9_]/g,
          "_",
        );
        const quoted = `"${dbName.replaceAll('"', '""')}"`;
        const admin = new pg.Client({
          connectionString: uriForDatabase(mainUri, "template1"),
        });
        await admin.connect();
        try {
          for (let attempt = 0; attempt < 10; attempt++) {
            await admin.query(`
              SELECT pg_terminate_backend(pid)
              FROM pg_stat_activity
              WHERE datname = 'postgres' AND pid <> pg_backend_pid()
            `);
            const remaining = await admin.query<{ n: number }>(`
              SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = 'postgres' AND pid <> pg_backend_pid()
            `);
            if ((remaining.rows[0]?.n ?? 0) === 0) break;
            await new Promise((r) => setTimeout(r, 50));
          }
          await admin.query(`CREATE DATABASE ${quoted} TEMPLATE postgres`);
        } finally {
          await admin.end().catch(() => {});
        }
        activeSetupMain = createSetupPool(mainUri);
        activeMainPool = createPostgresRolePool(mainUri);
        const pool = createPostgresRolePool(uriForDatabase(mainUri, dbName));
        return {
          pool,
          drop: async () => {
            await pool.end().catch(() => {});
            await activeSetupMain
              .query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`)
              .catch(() => {});
          },
        };
      },
      prepareDeclarativeShadow: async () => {
        await Promise.all([
          activeMainPool.end().catch(() => {}),
          activeSetupMain.end().catch(() => {}),
        ]);
      },
      mainUri,
      branchUri,
      migrationCount: migrations.length,
      cleanup: async () => {
        await Promise.all([
          activeSetupMain.end().catch(() => {}),
          activeSetupBranch.end().catch(() => {}),
          activeMainPool.end().catch(() => {}),
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

export { MIGRATIONS_DIR };
