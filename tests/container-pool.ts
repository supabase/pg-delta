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

class ContainerPool {
  private pools: Map<PostgresVersion, StartedPostgresAlpineContainer[]> =
    new Map();
  private activeDatabases: Set<string> = new Set();
  private dbCounter = 0;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private templateDatabases: Map<string, string> = new Map(); // container_id -> template_db_name
  private connectionPool: Map<string, postgres.Sql> = new Map(); // container_id -> postgres connection


  /**
   * Initialize the pool with containers for each PostgreSQL version
   */
  async initialize(versions: PostgresVersion[], poolSize = 3): Promise<void> {
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
    // Process all versions in parallel for maximum speed
    await Promise.all(
      versions.map(async (version) => {
        const containers: StartedPostgresAlpineContainer[] = [];
        const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[version]}`;

        try {
          // Create containers in parallel for each version
          const containerPromises = Array.from({ length: poolSize }, () =>
            new PostgresAlpineContainer(image).start(),
          );

          const startedContainers = await Promise.all(containerPromises);
          containers.push(...startedContainers);

          // Create connection pools for faster database operations
          await this.createConnectionPool(containers);

          this.pools.set(version, containers);
        } catch (error) {
          console.error(
            `Failed to start containers for PostgreSQL ${version}:`,
            error,
          );
          throw error;
        }
      })
    );
  }

  /**
   * Create template databases for faster database creation
   */
  private async createTemplateDatabases(
    containers: StartedPostgresAlpineContainer[],
  ): Promise<void> {
    await Promise.all(
      containers.map(async (container) => {
        const templateName = `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        try {
          await container.createDatabase(templateName);
          // Mark as template
          await container.execCommandsSQL([
            `ALTER DATABASE "${templateName}" WITH is_template = TRUE`,
          ]);
          this.templateDatabases.set(container.getId(), templateName);
        } catch (error) {
          console.error("Failed to create template database:", error);
          // Continue without template - will fall back to regular creation
        }
      }),
    );
  }

  /**
   * Create connection pool for admin operations
   */
  private async createConnectionPool(
    containers: StartedPostgresAlpineContainer[],
  ): Promise<void> {
    await Promise.all(
      containers.map(async (container) => {
        try {
          const adminConnection = postgres(
            container.getConnectionUriForDatabase("postgres"),
            { 
              ...postgresConfig,
              max: 1, // Single connection per container for admin operations
              idle_timeout: 60, // Keep alive for reuse
            },
          );
          this.connectionPool.set(container.getId(), adminConnection);
        } catch (error) {
          console.error("Failed to create admin connection:", error);
        }
      }),
    );
  }

  /**
   * Create database from template if available, otherwise create normally
   */
  private async createDatabaseFromTemplate(
    container: StartedPostgresAlpineContainer,
    dbName: string,
  ): Promise<void> {
    const templateName = this.templateDatabases.get(container.getId());
    const adminConnection = this.connectionPool.get(container.getId());
    
    if (adminConnection) {
      // Use pooled connection for faster database creation
      if (templateName) {
        await adminConnection.unsafe(`CREATE DATABASE "${dbName}" WITH TEMPLATE "${templateName}" OWNER "${container.getUsername()}"`);
      } else {
        await adminConnection.unsafe(`CREATE DATABASE "${dbName}" OWNER "${container.getUsername()}"`);
      }
    } else {
      // Fall back to container exec method
      if (templateName) {
        await container.execCommandsSQL([
          `CREATE DATABASE "${dbName}" WITH TEMPLATE "${templateName}" OWNER "${container.getUsername()}"`,
        ]);
      } else {
        await container.createDatabase(dbName);
      }
    }
  }

  /**
   * Fast database drop using pooled connections
   */
  private async dropDatabaseFast(
    container: StartedPostgresAlpineContainer,
    dbName: string,
  ): Promise<void> {
    const adminConnection = this.connectionPool.get(container.getId());
    
    if (adminConnection) {
      // Use pooled connection for faster database drop
      await adminConnection.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } else {
      // Fall back to container exec method
      await container.dropDatabase(dbName);
    }
  }

  /**
   * Ensure the pool is initialized with the given versions
   */
  private async ensureInitialized(versions: PostgresVersion[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize(versions, 3);
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

    // Select containers with least active databases for better load distribution
    const sortedContainers = containers
      .map((container) => ({
        container,
        activeDbs: Array.from(this.activeDatabases).filter((name) =>
          name.includes(container.getId())
        ).length,
      }))
      .sort((a, b) => a.activeDbs - b.activeDbs);

    const containerA = sortedContainers[0].container;
    const containerB = sortedContainers[1].container;

    // Generate unique database names with container IDs for better tracking
    const dbNameA = `test_db_${this.dbCounter++}_${containerA.getId().slice(-8)}_a`;
    const dbNameB = `test_db_${this.dbCounter++}_${containerB.getId().slice(-8)}_b`;

    // Create the databases using templates if available
    await Promise.all([
      this.createDatabaseFromTemplate(containerA, dbNameA),
      this.createDatabaseFromTemplate(containerB, dbNameB),
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

        // Drop databases using pooled connections for speed
        await Promise.all([
          this.dropDatabaseFast(containerA, dbNameA),
          this.dropDatabaseFast(containerB, dbNameB),
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
    // Close all pooled connections first
    const connectionPromises = Array.from(this.connectionPool.values()).map(
      (connection) => connection.end().catch(() => {}) // Ignore errors during cleanup
    );
    await Promise.all(connectionPromises);
    this.connectionPool.clear();

    // Stop all containers
    const allContainers = Array.from(this.pools.values()).flat();
    await Promise.all(allContainers.map((container) => container.stop()));
    
    this.pools.clear();
    this.activeDatabases.clear();
    this.templateDatabases.clear();
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
