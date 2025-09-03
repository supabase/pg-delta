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

class ContainerManager {
  private containers: Map<PostgresVersion, StartedPostgresAlpineContainer> =
    new Map();
  private dbCounter = 0;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Initialize with a single container for each PostgreSQL version
   */
  async initialize(versions: PostgresVersion[]): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize(versions);
    await this.initializationPromise;
    this.initialized = true;
  }

  private async _doInitialize(versions: PostgresVersion[]): Promise<void> {
    if (process.env.DEBUG) {
      console.log(
        `[ContainerManager] Initializing containers for versions: ${versions.join(", ")}`,
      );
    }

    for (const version of versions) {
      const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[version]}`;

      try {
        if (process.env.DEBUG) {
          console.log(
            `[ContainerManager] Starting container for PostgreSQL ${version}...`,
          );
        }

        const container = await new PostgresAlpineContainer(image).start();
        this.containers.set(version, container);

        if (process.env.DEBUG) {
          console.log(
            `[ContainerManager] Successfully started container for PostgreSQL ${version}`,
          );
        }
      } catch (error) {
        console.error(
          `Failed to start container for PostgreSQL ${version}:`,
          error,
        );
        throw error;
      }
    }

    if (process.env.DEBUG) {
      console.log(
        `[ContainerManager] Initialization complete. Total containers: ${this.containers.size}`,
      );
    }
  }

  /**
   * Ensure the manager is initialized with the given versions
   */
  private async ensureInitialized(versions: PostgresVersion[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize(versions);
    }
  }

  /**
   * Get a database pair (a, b) for testing from the container
   */
  async getDatabasePair(version: PostgresVersion): Promise<{
    a: postgres.Sql;
    b: postgres.Sql;
    cleanup: () => Promise<void>;
  }> {
    await this.ensureInitialized([version]);

    const container = this.containers.get(version);
    if (!container) {
      throw new Error(`No container available for PostgreSQL ${version}`);
    }

    // Generate unique database names
    const dbNameA = `test_db_${this.dbCounter++}_${Date.now()}_a`;
    const dbNameB = `test_db_${this.dbCounter++}_${Date.now()}_b`;

    // Create both databases on the same container
    await Promise.all([
      container.createDatabase(dbNameA),
      container.createDatabase(dbNameB),
    ]);

    // Create SQL connections to both databases on the same container
    const sqlA = postgres(
      container.getConnectionUriForDatabase(dbNameA),
      postgresConfig,
    );
    const sqlB = postgres(
      container.getConnectionUriForDatabase(dbNameB),
      postgresConfig,
    );

    const cleanup = async () => {
      try {
        // Close connections
        await Promise.all([sqlA.end(), sqlB.end()]);

        // Drop databases
        await Promise.all([
          container.dropDatabase(dbNameA),
          container.dropDatabase(dbNameB),
        ]);
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
   * Cleanup all containers
   */
  async cleanup(): Promise<void> {
    const allContainers = Array.from(this.containers.values());
    await Promise.all(allContainers.map((container) => container.stop()));
    this.containers.clear();
  }
}

// Global container manager instance - using globalThis to ensure singleton across modules
declare global {
  var __containerManager: ContainerManager | undefined;
}

export const containerManager =
  globalThis.__containerManager ||
  // biome-ignore lint/suspicious/noAssignInExpressions: this is a singleton
  (globalThis.__containerManager = new ContainerManager());
