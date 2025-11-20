import {
  AbstractStartedContainer,
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";

const POSTGRES_PORT = 5432;

export class SupabasePostgreSqlContainer extends GenericContainer {
  private database = "postgres";
  private username = "supabase_admin";
  private password = "postgres";

  constructor(image: string) {
    super(image);
    this.withExposedPorts(POSTGRES_PORT);
    this.withWaitStrategy(Wait.forHealthCheck());
    this.withStartupTimeout(120_000);
    this.withTmpFs({
      "/var/lib/postgresql/data": "rw,noexec,nosuid,size=256m",
    });
  }

  public withDatabase(database: string): this {
    this.database = database;
    return this;
  }

  public withUsername(username: string): this {
    this.username = username;
    return this;
  }

  public withPassword(password: string): this {
    this.password = password;
    return this;
  }

  public override async start(): Promise<StartedSupabasePostgreSqlContainer> {
    this.withEnvironment({
      POSTGRES_DB: this.database,
      POSTGRES_USER: this.username,
      POSTGRES_PASSWORD: this.password,
    });
    return new StartedSupabasePostgreSqlContainer(
      await super.start(),
      this.database,
      this.username,
      this.password,
    );
  }
}

export class StartedSupabasePostgreSqlContainer extends AbstractStartedContainer {
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
}
