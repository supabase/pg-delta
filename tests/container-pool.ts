import postgres from "postgres";
import { postgresConfig } from "../src/main.ts";
import {
  POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG,
  type PostgresVersion,
} from "./constants.ts";
import {
  PostgresAlpineContainer,
  type StartedPostgresAlpineContainer,
} from "./postgres-alpine.ts";

const POSTGRES_POOL_SIZE = process.env.POSTGRES_POOL_SIZE
  ? Number(process.env.POSTGRES_POOL_SIZE)
  : 2;

class ContainerPool {
  private pools: Map<PostgresVersion, StartedPostgresAlpineContainer[]> =
    new Map();
  private activeDatabases: Set<string> = new Set();
  private dbCounter = 0;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Initialize the pool with containers for each PostgreSQL version
   */
  async initialize(
    versions: PostgresVersion[],
    poolSize = POSTGRES_POOL_SIZE,
  ): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize(versions, poolSize);
    await this.initializationPromise;
    this.initialized = true;
  }

  private async _doInitialize(
    versions: PostgresVersion[],
    poolSize: number,
  ): Promise<void> {
    if (process.env.DEBUG) {
      console.log(
        `[ContainerPool] Initializing shared pool with ${poolSize} containers per version for versions: ${versions.join(", ")}`,
      );
    }

    for (const version of versions) {
      const containers: StartedPostgresAlpineContainer[] = [];
      const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[version]}`;

      try {
        if (process.env.DEBUG) {
          console.log(
            `[ContainerPool] Starting ${poolSize} containers for PostgreSQL ${version}...`,
          );
        }

        // Create containers in parallel for each version
        const containerPromises = Array.from({ length: poolSize }, () =>
          new PostgresAlpineContainer(image).start(),
        );

        const startedContainers = await Promise.all(containerPromises);
        containers.push(...startedContainers);

        this.pools.set(version, containers);

        if (process.env.DEBUG) {
          console.log(
            `[ContainerPool] Successfully started ${containers.length} containers for PostgreSQL ${version}`,
          );
        }
      } catch (error) {
        console.error(
          `Failed to start containers for PostgreSQL ${version}:`,
          error,
        );
        throw error;
      }
    }

    if (process.env.DEBUG) {
      console.log(
        `[ContainerPool] Pool initialization complete. Total containers: ${Array.from(this.pools.values()).flat().length}`,
      );
    }
  }

  /**
   * Ensure the pool is initialized with the given versions
   */
  private async ensureInitialized(versions: PostgresVersion[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize(versions, POSTGRES_POOL_SIZE);
    }
  }

  /**
   * Get a database pair (a, b) for testing from the pool
   */
  async getDatabasePair(version: PostgresVersion): Promise<{
    a: postgres.Sql;
    b: postgres.Sql;
    cleanup: () => Promise<void>;
  }> {
    // Ensure the pool is initialized for this version
    await this.ensureInitialized([version]);

    const containers = this.pools.get(version);
    if (!containers || containers.length < 2) {
      throw new Error(
        `Not enough containers available for PostgreSQL ${version}. Available: ${containers?.length || 0}, Required: 2`,
      );
    }

    // Get two containers (we'll use different databases on the same containers for better performance)
    const containerA = containers[0];
    const containerB = containers[1];

    // Generate unique database names
    const dbNameA = `test_db_${this.dbCounter++}_${Date.now()}_a`;
    const dbNameB = `test_db_${this.dbCounter++}_${Date.now()}_b`;

    // Create the databases
    await Promise.all([
      containerA.createDatabase(dbNameA),
      containerB.createDatabase(dbNameB),
    ]);

    // Create SQL connections
    const sqlA = postgres(
      containerA.getConnectionUriForDatabase(dbNameA),
      postgresConfig,
    );
    const sqlB = postgres(
      containerB.getConnectionUriForDatabase(dbNameB),
      postgresConfig,
    );

    // Track active databases
    this.activeDatabases.add(dbNameA);
    this.activeDatabases.add(dbNameB);

    const cleanup = async () => {
      try {
        // Close connections
        await Promise.all([sqlA.end(), sqlB.end()]);

        // Drop databases
        await Promise.all([
          containerA.dropDatabase(dbNameA),
          containerB.dropDatabase(dbNameB),
        ]);

        // Remove from active tracking
        this.activeDatabases.delete(dbNameA);
        this.activeDatabases.delete(dbNameB);
      } catch (error) {
        console.error("Error during database cleanup:", error);
      }
    };

    return { a: sqlA, b: sqlB, cleanup };
  }

  /**
   * Get isolated containers (creates new containers for the test)
   */
  async getIsolatedContainers(version: PostgresVersion): Promise<{
    a: postgres.Sql;
    b: postgres.Sql;
    cleanup: () => Promise<void>;
  }> {
    const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[version]}`;

    const [containerA, containerB] = await Promise.all([
      new PostgresAlpineContainer(image).start(),
      new PostgresAlpineContainer(image).start(),
    ]);

    const sqlA = postgres(containerA.getConnectionUri(), postgresConfig);
    const sqlB = postgres(containerB.getConnectionUri(), postgresConfig);

    const cleanup = async () => {
      try {
        await Promise.all([sqlA.end(), sqlB.end()]);
        await Promise.all([containerA.stop(), containerB.stop()]);
      } catch (error) {
        console.error("Error during isolated container cleanup:", error);
      }
    };

    return { a: sqlA, b: sqlB, cleanup };
  }

  /**
   * Cleanup all pools
   */
  async cleanup(): Promise<void> {
    const allContainers = Array.from(this.pools.values()).flat();
    await Promise.all(allContainers.map((container) => container.stop()));
    this.pools.clear();
    this.activeDatabases.clear();
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    version: PostgresVersion;
    containerCount: number;
    activeDatabases: number;
  }[] {
    return Array.from(this.pools.entries()).map(([version, containers]) => ({
      version,
      containerCount: containers.length,
      activeDatabases: Array.from(this.activeDatabases).filter(
        (name) =>
          name.includes(`_${version}_`) || name.includes(`pg${version}`),
      ).length,
    }));
  }
}

// Global container pool instance - using globalThis to ensure singleton across modules
declare global {
  var __containerPool: ContainerPool | undefined;
}

export const containerPool =
  globalThis.__containerPool ||
  // biome-ignore lint/suspicious/noAssignInExpressions: this is a singleton
  (globalThis.__containerPool = new ContainerPool());
