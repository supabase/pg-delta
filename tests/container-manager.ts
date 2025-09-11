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
  private initializedVersions: Set<PostgresVersion> = new Set();
  private initializationPromises: Map<PostgresVersion, Promise<void>> =
    new Map();

  /**
   * Initialize with a single container for each PostgreSQL version
   */
  async initialize(versions: PostgresVersion[]): Promise<void> {
    // Filter out versions that are already initialized
    const versionsToInitialize = versions.filter(
      (version) => !this.initializedVersions.has(version),
    );

    if (versionsToInitialize.length === 0) {
      return;
    }

    // Start initialization for all versions that need it
    const initializationPromises = versionsToInitialize.map((version) =>
      this._initializeVersion(version),
    );
    await Promise.all(initializationPromises);
  }

  private async _initializeVersion(version: PostgresVersion): Promise<void> {
    // Check if already initialized
    if (this.initializedVersions.has(version)) {
      return;
    }

    // Check if initialization is already in progress for this version
    const existingPromise = this.initializationPromises.get(version);
    if (existingPromise) {
      return existingPromise;
    }

    // Start initialization for this version
    const initPromise = this._doInitializeVersion(version);
    this.initializationPromises.set(version, initPromise);

    try {
      await initPromise;
      this.initializedVersions.add(version);
    } finally {
      // Clean up the promise once done
      this.initializationPromises.delete(version);
    }
  }

  private async _doInitializeVersion(version: PostgresVersion): Promise<void> {
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

  /**
   * Ensure the manager is initialized with the given versions
   */
  private async ensureInitialized(versions: PostgresVersion[]): Promise<void> {
    const versionsToInitialize = versions.filter(
      (version) => !this.initializedVersions.has(version),
    );
    if (versionsToInitialize.length > 0) {
      await this.initialize(versionsToInitialize);
    }
  }

  /**
   * Get a database pair (main, branch) for testing from the container
   */
  async getDatabasePair(version: PostgresVersion): Promise<{
    main: postgres.Sql;
    branch: postgres.Sql;
    cleanup: () => Promise<void>;
  }> {
    if (process.env.DEBUG) {
      console.log(
        `[ContainerManager] Getting database pair for PostgreSQL ${version}`,
      );
    }
    await this.ensureInitialized([version]);

    const container = this.containers.get(version);
    if (!container) {
      throw new Error(`No container available for PostgreSQL ${version}`);
    }

    // Generate unique database names
    const dbNameMain = `test_db_${this.dbCounter++}_${Date.now()}_main`;
    const dbNameBranch = `test_db_${this.dbCounter++}_${Date.now()}_branch`;

    // Create both databases on the same container
    await Promise.all([
      container.createDatabase(dbNameMain),
      container.createDatabase(dbNameBranch),
    ]);

    // Create SQL connections to both databases on the same container
    const sqlMain = postgres(
      container.getConnectionUriForDatabase(dbNameMain),
      postgresConfig,
    );
    const sqlBranch = postgres(
      container.getConnectionUriForDatabase(dbNameBranch),
      postgresConfig,
    );

    const cleanup = async () => {
      try {
        // Close connections
        await Promise.all([sqlMain.end(), sqlBranch.end()]);

        // Drop databases
        await Promise.all([
          container.dropDatabase(dbNameMain),
          container.dropDatabase(dbNameBranch),
        ]);
      } catch (error) {
        console.error("Error during database cleanup:", error);
      }
    };

    return { main: sqlMain, branch: sqlBranch, cleanup };
  }

  /**
   * Get isolated containers (creates new containers for the test)
   */
  async getIsolatedContainers(version: PostgresVersion): Promise<{
    main: postgres.Sql;
    branch: postgres.Sql;
    cleanup: () => Promise<void>;
  }> {
    const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[version]}`;

    const [containerMain, containerBranch] = await Promise.all([
      new PostgresAlpineContainer(image).start(),
      new PostgresAlpineContainer(image).start(),
    ]);

    const sqlMain = postgres(containerMain.getConnectionUri(), postgresConfig);
    const sqlBranch = postgres(
      containerBranch.getConnectionUri(),
      postgresConfig,
    );

    const cleanup = async () => {
      try {
        await Promise.all([sqlMain.end(), sqlBranch.end()]);
        await Promise.all([containerMain.stop(), containerBranch.stop()]);
      } catch (error) {
        console.error("Error during isolated container cleanup:", error);
      }
    };

    return { main: sqlMain, branch: sqlBranch, cleanup };
  }

  /**
   * Cleanup all containers
   */
  async cleanup(): Promise<void> {
    await Promise.all(
      this.containers.values().map((container) => container.stop()),
    );
    this.containers.clear();
    this.initializedVersions.clear();
    this.initializationPromises.clear();
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
