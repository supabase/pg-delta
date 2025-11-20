import {
  AbstractStartedContainer,
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";

const POSTGRES_PORT = 5432;

export class PostgresAlpineContainer extends GenericContainer {
  private database = "postgres";
  private username = "postgres";
  private password = "postgres";

  constructor(image: string) {
    super(image);
    this.withExposedPorts(POSTGRES_PORT);
    this.withWaitStrategy(
      Wait.forSuccessfulCommand("pg_isready -U postgres -h localhost"),
    );
    this.withStartupTimeout(120_000);
    this.withTmpFs({
      "/var/lib/postgresql/data": "rw,noexec,nosuid,size=256m",
    });
    // Enable logical replication to be able to create subscriptions
    this.withCommand(["postgres", "-c", "wal_level=logical"]);
  }

  public override async start(): Promise<StartedPostgresAlpineContainer> {
    this.withEnvironment({
      POSTGRES_DB: this.database,
      POSTGRES_USER: this.username,
      POSTGRES_PASSWORD: this.password,
    });

    return new StartedPostgresAlpineContainer(
      await super.start(),
      this.database,
      this.username,
      this.password,
    );
  }
}

export class StartedPostgresAlpineContainer extends AbstractStartedContainer {
  private readonly database: string;
  private readonly username: string;
  private readonly password: string;

  constructor(
    startedTestContainer: StartedTestContainer,
    database: string,
    username: string,
    password: string,
  ) {
    super(startedTestContainer);
    this.database = database;
    this.username = username;
    this.password = password;
  }

  public getPort(): number {
    return super.getMappedPort(POSTGRES_PORT);
  }

  public getDatabase(): string {
    return this.database;
  }

  public getUsername(): string {
    return this.username;
  }

  public getPassword(): string {
    return this.password;
  }

  /**
   * @returns A connection URI in the form of `postgres[ql]://[username[:password]@][host[:port],]/database`
   */
  public getConnectionUri(): string {
    const url = new URL("", "postgres://");
    url.hostname = this.getHost();
    url.port = this.getPort().toString();
    url.pathname = this.getDatabase();
    url.username = this.getUsername();
    url.password = this.getPassword();
    return url.toString();
  }

  /**
   * Get connection URI for a specific database
   */
  public getConnectionUriForDatabase(dbName: string): string {
    const url = new URL("", "postgres://");
    url.hostname = this.getHost();
    url.port = this.getPort().toString();
    url.pathname = dbName;
    url.username = this.getUsername();
    url.password = this.getPassword();
    return url.toString();
  }

  /**
   * Creates a new database for testing
   */
  public async createDatabase(dbName: string): Promise<void> {
    await this.execCommandsSQL([
      `CREATE DATABASE "${dbName}" OWNER "${this.getUsername()}"`,
    ]);
  }

  /**
   * Drops a database
   */
  public async dropDatabase(dbName: string): Promise<void> {
    const listResult = await this.exec([
      "psql",
      "-At",
      "-U",
      this.getUsername(),
      "-d",
      dbName,
      "-c",
      "SELECT quote_ident(subname) FROM pg_catalog.pg_subscription WHERE subdbid = (SELECT oid FROM pg_database WHERE datname = current_database());",
    ]);
    if (listResult.exitCode !== 0) {
      throw new Error(
        `Command failed with exit code ${listResult.exitCode}: ${listResult.output}`,
      );
    }
    const subscriptionNames = listResult.output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const subName of subscriptionNames) {
      await this.execCommandsSQL(
        [
          `ALTER SUBSCRIPTION ${subName} SET (slot_name = NONE)`,
          `DROP SUBSCRIPTION ${subName}`,
        ],
        dbName,
      );
    }
    await this.execCommandsSQL([
      `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
    ]);
  }

  /**
   * Executes a series of SQL commands against the Postgres database
   *
   * @param commands Array of SQL commands to execute in sequence
   * @throws Error if any command fails to execute with details of the failure
   */
  private async execCommandsSQL(
    commands: string[],
    database: string = "postgres",
  ): Promise<void> {
    for (const command of commands) {
      try {
        const result = await this.exec([
          "psql",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          this.getUsername(),
          "-d",
          database,
          "-c",
          command,
        ]);

        if (result.exitCode !== 0) {
          throw new Error(
            `Command failed with exit code ${result.exitCode}: ${result.output}`,
          );
        }
      } catch (error) {
        console.error(`Failed to execute command: ${command}`, error);
        throw error;
      }
    }
  }
}
