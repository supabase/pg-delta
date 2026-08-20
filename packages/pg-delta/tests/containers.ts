/**
 * Test-container manager: one shared PostgreSQL cluster (databases as the
 * isolation unit) plus a lazily started PAIR of clusters for scenarios whose
 * point is cluster-level state (roles/memberships/default privileges) — those
 * run state A and state B on different clusters.
 *
 * `isolatedClusterPair()` is a SINGLETON pair shared by every cluster-level
 * test, and roles are cluster-global, so roles ACCUMULATE across scenarios.
 * There is NO automatic role cleanup — `dropRolesExcept` is exposed but each
 * caller must call it. Cleanup is best-effort by default because a role owning
 * objects in another still-live test database cannot be dropped until that
 * database is gone; callers that require isolation can enable strict
 * postcondition verification. The established pattern for role-heavy tests
 * otherwise avoids pollution by construction: use distinctive role names/configs
 * so rename detection stays unambiguous, and prove plans that drop/rename roles
 * against the SACRIFICIAL source database directly (never a clone — a clone
 * leaves the original source pinning the old role; see owner-edge.test.ts).
 */
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import pg from "pg";

const PG_IMAGE = process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine";

/** Supabase image (ships pg_partman / pgmq / pg_cron) for extension-intent
 *  integration tests (docs/architecture/extension-intent.md). Exported so the
 *  baseline-fixture pipeline (scripts/sync-supabase-base-images.ts) boots the
 *  exact same tag it validates against. */
export const SUPABASE_IMAGE =
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
/** Major version of the pinned Supabase image — names the baseline fixture
 *  (tests/fixtures/supabase-base-init/<major>.sql) and its regeneration. */
export const SUPABASE_BARE_MAJOR = Number(
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
  /** A `postgres`-role connection URI for this database, present only on the
   *  Supabase cluster (`supabaseCluster()`), where a faithful non-superuser
   *  `postgres` role is provisioned at cluster start. Use this for anything that
   *  simulates real `--target` usage (Supabase hands users `postgres`, never
   *  `supabase_admin`). Undefined on the stock/seclabel clusters. */
  postgresUri?: string | undefined;
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
    /** Optional parallel URI builder for a non-admin `postgres` role (Supabase
     *  cluster only); populates `TestDb.postgresUri`. */
    readonly postgresUriFor?: (db: string) => string,
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
      postgresUri: this.postgresUriFor?.(name),
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

  /** Drop roles created since `baseline`; strict mode verifies the postcondition. */
  async dropRolesExcept(
    baseline: Set<string>,
    options: { strict?: boolean } = {},
  ): Promise<void> {
    const current = await this.listRoles();
    const cleanupErrors: string[] = [];
    for (const role of current) {
      if (baseline.has(role)) continue;
      const quoted = `"${role.replaceAll('"', '""')}"`;
      try {
        await this.adminPool.query(`DROP OWNED BY ${quoted} CASCADE`);
      } catch (error) {
        cleanupErrors.push(`${role} DROP OWNED: ${String(error)}`);
      }
      try {
        await this.adminPool.query(`DROP ROLE IF EXISTS ${quoted}`);
      } catch (error) {
        cleanupErrors.push(`${role} DROP ROLE: ${String(error)}`);
      }
    }

    if (options.strict) {
      const remaining = [...(await this.listRoles())]
        .filter((role) => !baseline.has(role))
        .sort();
      if (remaining.length > 0) {
        const detail =
          cleanupErrors.length > 0
            ? `; cleanup errors: ${cleanupErrors.join("; ")}`
            : "";
        throw new Error(
          `Role cleanup incomplete; non-baseline roles remain: ${remaining.join(", ")}${detail}`,
        );
      }
    }
  }

  /** Tear down the cluster: close the admin pool and stop the container. */
  async stop(): Promise<void> {
    await this.adminPool.end().catch(() => {});
    await this.container.stop().catch(() => {});
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

async function systemIdentifier(cluster: Cluster): Promise<string> {
  const res = await cluster.adminPool.query<{ id: string }>(
    `SELECT system_identifier::text AS id FROM pg_catalog.pg_control_system()`,
  );
  const id = res.rows[0]?.id;
  if (id === undefined) {
    throw new Error("could not read pg_control_system().system_identifier");
  }
  return id;
}

/** initdb derives pg_control_system().system_identifier from the wall clock
 *  (seconds + microseconds) and initdb's pid, so two containers initdb'ing
 *  concurrently can — rarely — collide (observed once on CI PG 15). The
 *  isolated-shadow lineage guard keys on that identifier, so a colliding pair
 *  makes every isolated-shadow test fail while all other pair tests pass.
 *  Verify distinctness and restart the second cluster on collision (a retry
 *  initdb runs at a later wall-clock second, so one retry suffices). */
async function startDistinctLineagePair(): Promise<[Cluster, Cluster]> {
  const [first, second] = await Promise.all([startCluster(), startCluster()]);
  let candidate = second;
  for (let attempt = 0; ; attempt++) {
    const [firstId, candidateId] = await Promise.all([
      systemIdentifier(first),
      systemIdentifier(candidate),
    ]);
    if (firstId !== candidateId) return [first, candidate];
    if (attempt >= 2) {
      throw new Error(
        "isolatedClusterPair: clusters share a system_identifier after 3 attempts",
      );
    }
    await candidate.stop();
    candidate = await startCluster();
  }
}

let isolatedPair: Promise<[Cluster, Cluster]> | null = null;
/** Two extra clusters for cluster-level-difference scenarios (A-side, B-side).
 *  Guaranteed to be two distinct PostgreSQL lineages (system identifiers). */
export async function isolatedClusterPair(): Promise<[Cluster, Cluster]> {
  isolatedPair ??= startDistinctLineagePair();
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
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const uriFor = (db: string) =>
    `postgres://supabase_admin:postgres@${host}:${port}/${db}`;
  // Real Supabase projects hand users a `postgres`-role connection, never
  // `supabase_admin` (that's Supabase's internal platform-admin role). Expose a
  // parallel per-db builder so tests that simulate real `--target` usage own the
  // shadow load + apply as `postgres`.
  const postgresUriFor = (db: string) =>
    `postgres://postgres:postgres@${host}:${port}/${db}`;
  const adminPool = new pg.Pool({
    connectionString: uriFor("postgres"),
    max: 3,
  });
  adminPool.on("error", () => {});
  // Make `postgres` connectable exactly the way real Supabase Cloud exposes it:
  // a NON-superuser member of `supabase_privileged_role`. The image's `supautils`
  // (session-preloaded, `supautils.privileged_role = 'supabase_privileged_role'`)
  // elevates that role just enough — session-level GUCs in
  // `privileged_role_allowed_configs` (e.g. `log_min_messages`), and CREATE EVENT
  // TRIGGER via a switch-to-`supautils.superuser`-then-reassign-owner path, so
  // objects a privileged-role member creates are owned by that member
  // (`postgres`), matching Cloud. Granting real SUPERUSER instead would be
  // unfaithful: superuser-created event triggers take supautils' genuine-superuser
  // path, which coerces ownership to `supabase_admin`, so user event triggers
  // (e.g. Studio's `ensure_rls`) drift owner and the Supabase profile then
  // excludes them from export.
  //
  // The role + grant mirror the image's own migration
  // `20260211120934_supabase_privileged_role.sql` (newer tags ship it; the pinned
  // tag predates it) — idempotent, a no-op once the image includes it. Roles are
  // cluster-global, so this runs ONCE at cluster start (a per-test CREATE ROLE
  // would race across the shared databases).
  await adminPool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_privileged_role') THEN
        CREATE ROLE supabase_privileged_role;
      END IF;
    END $$;`);
  await adminPool.query("GRANT supabase_privileged_role TO postgres");
  await adminPool.query(
    "ALTER ROLE postgres WITH LOGIN NOSUPERUSER PASSWORD 'postgres'",
  );
  return new Cluster(container, adminPool, uriFor, postgresUriFor);
}

let supabaseShared: Promise<Cluster> | null = null;
export async function supabaseCluster(): Promise<Cluster> {
  supabaseShared ??= startSupabaseCluster();
  return supabaseShared;
}

/** A fresh, standalone Supabase-image container (its own cluster, NOT the shared
 *  singleton). The dbdev-roundtrip fixture needs two independent containers
 *  because Supabase only permits CREATE EXTENSION in the `postgres` database,
 *  so the shared cluster's per-test databases won't do. Connects as
 *  `supabase_admin`, matching the committed base-init fixture. */
export interface StartedStandaloneSupabase {
  connectionUri(db?: string): string;
  /** Real Supabase projects hand users a `postgres`-role connection, never
   *  `supabase_admin` (that's Supabase's internal platform-admin role). Use
   *  this for anything meant to simulate real `--target` usage. */
  postgresConnectionUri(db?: string): string;
  stop(): Promise<void>;
}

export async function startStandaloneSupabase(): Promise<StartedStandaloneSupabase> {
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
  const host = container.getHost();
  const port = container.getMappedPort(5432);

  // Make `postgres` connectable exactly the way real Supabase Cloud exposes it:
  // a NON-superuser member of `supabase_privileged_role`. The image's `supautils`
  // (session-preloaded, `supautils.privileged_role = 'supabase_privileged_role'`)
  // elevates that role just enough — session-level GUCs in
  // `privileged_role_allowed_configs` (e.g. `log_min_messages`), and CREATE EVENT
  // TRIGGER via a switch-to-`supautils.superuser`-then-reassign-owner path, so
  // objects a privileged-role member creates are owned by that member
  // (`postgres`), matching Cloud. Granting real SUPERUSER instead would be
  // unfaithful: superuser-created event triggers take supautils' genuine-superuser
  // path, which coerces ownership to `supabase_admin`, so user event triggers
  // (e.g. Studio's `ensure_rls`) drift owner and the Supabase profile then
  // excludes them from export.
  //
  // The role + grant mirror the image's own migration
  // `20260211120934_supabase_privileged_role.sql` (newer tags ship it; the pinned
  // tag predates it) — idempotent, a no-op once the image includes it.
  // The co-located-shadow seed replays as this non-superuser role since the
  // seed hardening in seed-assumed-schemas.ts (SUSET SET clauses stripped,
  // platform ADP entries omitted).
  const adminPool = new pg.Pool({
    connectionString: `postgres://supabase_admin:postgres@${host}:${port}/postgres`,
    max: 1,
  });
  adminPool.on("error", () => {});
  try {
    await adminPool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_privileged_role') THEN
          CREATE ROLE supabase_privileged_role;
        END IF;
      END $$;`);
    await adminPool.query("GRANT supabase_privileged_role TO postgres");
    await adminPool.query(
      "ALTER ROLE postgres WITH LOGIN NOSUPERUSER PASSWORD 'postgres'",
    );
  } finally {
    await adminPool.end();
  }

  return {
    connectionUri: (db = "postgres") =>
      `postgres://supabase_admin:postgres@${host}:${port}/${db}`,
    postgresConnectionUri: (db = "postgres") =>
      `postgres://postgres:postgres@${host}:${port}/${db}`,
    stop: async () => {
      await container.stop();
    },
  };
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

/** The dummy_seclabel image build reaches three networks (the Docker registry
 *  for the base images, the Alpine CDN for `apk add`, raw.githubusercontent.com
 *  for the module source), and any of them flakes transiently on shared CI
 *  egress — observed as testcontainers' bare "Failed to build image" taking
 *  four security-label test files down in one CI run. Retry with backoff;
 *  Docker's layer cache makes a retry resume from the last good layer. */
async function buildSeclabelImage(major: number) {
  const delaysMs = [0, 5_000, 15_000];
  let lastError: unknown;
  for (const delayMs of delaysMs) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      return await GenericContainer.fromDockerfile(
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
    } catch (error) {
      lastError = error;
      console.error(
        `dummy_seclabel image build failed (attempt ${delaysMs.indexOf(delayMs) + 1}/${delaysMs.length}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  throw lastError;
}

async function startSeclabelCluster(): Promise<Cluster> {
  const major = SECLABEL_PG_MAJOR;
  // build-or-reuse the dummy_seclabel image (Docker layer cache makes repeat
  // runs cheap; the first build compiles the module from PG source)
  const built = await buildSeclabelImage(major);
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
  // Never cache a REJECTED start: the singleton exists to share one healthy
  // cluster, and memoizing a transient failure (image build flake, slow
  // startup) would instantly fail every later seclabel test in the process
  // instead of letting the next caller try again.
  seclabelShared ??= startSeclabelCluster().catch((error: unknown) => {
    seclabelShared = null;
    throw error;
  });
  return seclabelShared;
}

/**
 * Stop every started singleton cluster and reset the singletons so a later call
 * re-starts fresh. The `withDb`-style test teardown only drops databases, never
 * the shared containers; standalone scripts (e.g. the dogfood suite) call this
 * in a `finally` so a run leaks no containers. Ryuk still reaps on process
 * death — this is the clean in-process path.
 */
export async function stopAllClusters(): Promise<void> {
  const pending = [shared, supabaseShared, seclabelShared].filter(
    (p): p is Promise<Cluster> => p !== null,
  );
  const pairPending = isolatedPair;
  shared = null;
  supabaseShared = null;
  seclabelShared = null;
  isolatedPair = null;

  const clusters = (
    await Promise.all(pending.map((p) => p.catch(() => null)))
  ).filter((c): c is Cluster => c !== null);
  if (pairPending) {
    const pair = await pairPending.catch(() => null);
    if (pair) clusters.push(...pair);
  }
  await Promise.all(clusters.map((c) => c.stop()));
}
