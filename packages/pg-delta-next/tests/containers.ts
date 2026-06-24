/**
 * Test-container manager: one shared PostgreSQL cluster (databases as the
 * isolation unit) plus a lazily started PAIR of clusters for scenarios whose
 * point is cluster-level state (roles/memberships/default privileges) — those
 * run state A and state B on different clusters.
 *
 * `isolatedClusterPair()` is a SINGLETON pair shared by every cluster-level
 * test, and roles are cluster-global, so roles ACCUMULATE across scenarios.
 * There is NO automatic role cleanup — `dropRolesExcept` is exposed but each
 * caller must call it (and even then it is best-effort: a role owning objects
 * in another still-live test database cannot be dropped until that database is
 * gone). The established pattern for role-heavy tests instead avoids pollution
 * by construction: use distinctive role names/configs so rename detection stays
 * unambiguous, and prove plans that drop/rename roles against the SACRIFICIAL
 * source database directly (never a clone — a clone leaves the original source
 * pinning the old role; see owner-edge.test.ts).
 */
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import pg from "pg";

const PG_IMAGE = process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine";

/** Supabase image (ships pg_partman / pgmq / pg_cron) for extension-intent
 *  integration tests (docs/architecture/extension-intent.md). */
const SUPABASE_IMAGE =
  process.env["PGDELTA_SUPABASE_TEST_IMAGE"] ?? "supabase/postgres:17.6.1.135";

/**
 * Self-gate for heavy bare-Supabase-image tests (`supabaseCluster()`).
 *
 * The bare image is a fixed major (17), independent of the matrix leg's
 * `PGDELTA_TEST_IMAGE`. Without a gate a new Supabase integration file would
 * spin that heavy image on ALL five CI legs (14/15/16/17/18) every PR for zero
 * extra coverage — the image major never changes. So run these once, on the leg
 * whose major matches the image; honor a hard opt-out
 * (`PGDELTA_NEXT_SUPABASE_TESTS=0`, e.g. forked PRs without image access) and a
 * force override (`=1`) for local single-file runs on a non-matching leg.
 *
 * Use as `describe.skipIf(!runSupabaseBareTests)(...)`.
 */
const LEG_PG_MAJOR = Number(/postgres:(\d+)/.exec(PG_IMAGE)?.[1] ?? "17");
const SUPABASE_BARE_MAJOR = Number(
  /postgres:(\d+)/.exec(SUPABASE_IMAGE)?.[1] ?? "17",
);
export const runSupabaseBareTests =
  process.env["PGDELTA_NEXT_SUPABASE_TESTS"] !== "0" &&
  (process.env["PGDELTA_NEXT_SUPABASE_TESTS"] === "1" ||
    LEG_PG_MAJOR === SUPABASE_BARE_MAJOR);

let dbCounter = 0;

export interface TestDb {
  name: string;
  pool: pg.Pool;
  uri: string;
  cluster: Cluster;
  /** Create a clone of this database via CREATE DATABASE … TEMPLATE. */
  clone(): Promise<TestDb>;
  drop(): Promise<void>;
}

export class Cluster {
  #pgMajor: number | undefined;

  constructor(
    readonly container: StartedTestContainer,
    readonly adminPool: pg.Pool,
    readonly uriFor: (db: string) => string,
  ) {}

  async pgMajor(): Promise<number> {
    if (this.#pgMajor === undefined) {
      const res = await this.adminPool.query(
        `SELECT current_setting('server_version_num')::int AS v`,
      );
      this.#pgMajor = Math.floor((res.rows[0] as { v: number }).v / 10000);
    }
    return this.#pgMajor;
  }

  async createDb(prefix = "t"): Promise<TestDb> {
    const name = `${prefix}_${dbCounter++}`;
    await this.adminPool.query(`CREATE DATABASE "${name}"`);
    return this.#makeDb(name);
  }

  #makeDb(name: string): TestDb {
    const uri = this.uriFor(name);
    const pool = new pg.Pool({ connectionString: uri, max: 5 });
    pool.on("error", () => {});
    const cluster = this as Cluster;
    return {
      name,
      pool,
      uri,
      cluster,
      async clone() {
        // TEMPLATE requires zero connections on the source
        await this.pool.end().catch(() => {});
        const cloneName = `${name}_c${dbCounter++}`;
        await cluster.adminPool.query(
          `CREATE DATABASE "${cloneName}" TEMPLATE "${name}"`,
        );
        const fresh = cluster.#makeDb(cloneName);
        const reopened = new pg.Pool({ connectionString: uri, max: 5 });
        reopened.on("error", () => {});
        (this as { pool: pg.Pool }).pool = reopened;
        return fresh;
      },
      async drop() {
        // DROP DATABASE refuses databases that still own subscriptions
        try {
          const subs = await this.pool.query(
            `SELECT subname FROM pg_subscription
             WHERE subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())`,
          );
          for (const row of subs.rows as { subname: string }[]) {
            const sub = `"${row.subname.replaceAll('"', '""')}"`;
            await this.pool
              .query(`ALTER SUBSCRIPTION ${sub} DISABLE`)
              .catch(() => {});
            await this.pool
              .query(`ALTER SUBSCRIPTION ${sub} SET (slot_name = NONE)`)
              .catch(() => {});
            await this.pool.query(`DROP SUBSCRIPTION ${sub}`).catch(() => {});
          }
        } catch {
          // no subscriptions or already gone — fine
        }
        await this.pool.end().catch(() => {});
        await cluster.adminPool.query(
          `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
        );
      },
    };
  }

  async listRoles(): Promise<Set<string>> {
    const res = await this.adminPool.query(
      `SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%'`,
    );
    return new Set(res.rows.map((r) => (r as { rolname: string }).rolname));
  }

  /** Drop roles created since `baseline` (scenario cleanup). */
  async dropRolesExcept(baseline: Set<string>): Promise<void> {
    const current = await this.listRoles();
    for (const role of current) {
      if (baseline.has(role)) continue;
      const quoted = `"${role.replaceAll('"', '""')}"`;
      await this.adminPool
        .query(`DROP OWNED BY ${quoted} CASCADE`)
        .catch(() => {});
      await this.adminPool
        .query(`DROP ROLE IF EXISTS ${quoted}`)
        .catch(() => {});
    }
  }
}

async function startCluster(): Promise<Cluster> {
  const container = await new GenericContainer(PG_IMAGE)
    .withEnvironment({
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "postgres",
    })
    .withCommand([
      "postgres",
      "-c",
      "fsync=off",
      "-c",
      "full_page_writes=off",
      "-c",
      "max_connections=300",
      "-c",
      "wal_level=logical",
    ])
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .start();
  const uriFor = (db: string) =>
    `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/${db}`;
  const adminPool = new pg.Pool({
    connectionString: uriFor("postgres"),
    max: 3,
  });
  adminPool.on("error", () => {});
  return new Cluster(container, adminPool, uriFor);
}

let shared: Promise<Cluster> | null = null;
export async function sharedCluster(): Promise<Cluster> {
  shared ??= startCluster();
  return shared;
}

let isolatedPair: Promise<[Cluster, Cluster]> | null = null;
/** Two extra clusters for cluster-level-difference scenarios (A-side, B-side). */
export async function isolatedClusterPair(): Promise<[Cluster, Cluster]> {
  isolatedPair ??= Promise.all([startCluster(), startCluster()]);
  return isolatedPair;
}

export async function createTestDb(prefix = "t"): Promise<TestDb> {
  return (await sharedCluster()).createDb(prefix);
}

/**
 * Start a Supabase-image cluster (`supabase/postgres`, which ships pg_partman /
 * pgmq / pg_cron). Used by extension-intent integration tests; the image is
 * heavy, so this is a separate lazy singleton from the stock alpine cluster.
 * Connects as `supabase_admin`; databases are the isolation unit, as usual.
 */
async function startSupabaseCluster(): Promise<Cluster> {
  const container = await new GenericContainer(SUPABASE_IMAGE)
    .withEnvironment({
      POSTGRES_USER: "supabase_admin",
      POSTGRES_PASSWORD: "postgres",
      POSTGRES_DB: "postgres",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(180_000)
    .withTmpFs({ "/var/lib/postgresql/data": "rw,noexec,nosuid,size=512m" })
    .start();
  const uriFor = (db: string) =>
    `postgres://supabase_admin:postgres@${container.getHost()}:${container.getMappedPort(5432)}/${db}`;
  const adminPool = new pg.Pool({
    connectionString: uriFor("postgres"),
    max: 3,
  });
  adminPool.on("error", () => {});
  return new Cluster(container, adminPool, uriFor);
}

let supabaseShared: Promise<Cluster> | null = null;
export async function supabaseCluster(): Promise<Cluster> {
  supabaseShared ??= startSupabaseCluster();
  return supabaseShared;
}

/** The security-label end-to-end proof needs a loaded label provider. We build
 *  a `postgres:<major>-alpine` image with the `dummy_seclabel` test module
 *  compiled in (tests/dummy-seclabel.Dockerfile) and preload it. Sandboxes that
 *  cannot reach the Alpine / GitHub CDNs at build time set
 *  `PGDELTA_SKIP_DUMMY_SECLABEL_BUILD=1`; the proof test skips itself. */
export const skipSeclabelProof =
  process.env["PGDELTA_SKIP_DUMMY_SECLABEL_BUILD"] === "1" ||
  process.env["PGDELTA_SKIP_DUMMY_SECLABEL_BUILD"] === "true";

const SECLABEL_PG_MAJOR = Number(/postgres:(\d+)/.exec(PG_IMAGE)?.[1] ?? "17");
// Alpine base that ships the matching postgresql<major>-dev headers for the
// dummy_seclabel build. 14 reuses 3.19 (postgresql14-dev 14.17) and 16 reuses
// 3.23 (postgresql16-dev 16.14), so no new Alpine base images are introduced.
const ALPINE_TAG_FOR_PG_MAJOR: Record<number, string> = {
  14: "3.19",
  15: "3.19",
  16: "3.23",
  17: "3.23",
  18: "3.23",
};

async function startSeclabelCluster(): Promise<Cluster> {
  const major = SECLABEL_PG_MAJOR;
  // build-or-reuse the dummy_seclabel image (Docker layer cache makes repeat
  // runs cheap; the first build compiles the module from PG source)
  const built = await GenericContainer.fromDockerfile(
    import.meta.dir,
    "dummy-seclabel.Dockerfile",
  )
    .withBuildArgs({
      PG_MAJOR: String(major),
      PG_BRANCH: `REL_${major}_STABLE`,
      ALPINE_TAG: ALPINE_TAG_FOR_PG_MAJOR[major] ?? "3.23",
    })
    .withCache(true)
    .build(`pg-delta-next-seclabel:${major}`, { deleteOnExit: false });
  const container = await built
    .withEnvironment({
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "postgres",
    })
    .withCommand([
      "postgres",
      "-c",
      "fsync=off",
      "-c",
      "full_page_writes=off",
      "-c",
      "max_connections=300",
      "-c",
      "wal_level=logical",
      "-c",
      "shared_preload_libraries=dummy_seclabel",
    ])
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .withStartupTimeout(240_000)
    .start();
  const uriFor = (db: string) =>
    `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/${db}`;
  const adminPool = new pg.Pool({
    connectionString: uriFor("postgres"),
    max: 3,
  });
  adminPool.on("error", () => {});
  return new Cluster(container, adminPool, uriFor);
}

let seclabelShared: Promise<Cluster> | null = null;
export async function seclabelCluster(): Promise<Cluster> {
  seclabelShared ??= startSeclabelCluster();
  return seclabelShared;
}
