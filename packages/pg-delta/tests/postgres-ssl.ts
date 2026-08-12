import {
  AbstractStartedContainer,
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import type { SslCertificates } from "./ssl-utils.ts";

const POSTGRES_PORT = 5432;

import { basename, dirname } from "node:path";

export class PostgresSslContainer extends GenericContainer {
  private database = "postgres";
  private username = "postgres";
  private password = "postgres";
  private certificates: SslCertificates;
  private serverCertName: string;
  private serverKeyName: string;

  constructor(image: string, certificates: SslCertificates) {
    super(image);
    this.withLabels({ "pg-toolbelt.package": "pg-delta" });
    this.certificates = certificates;
    this.serverCertName = basename(certificates.serverCert);
    this.serverKeyName = basename(certificates.serverKey);
    this.withExposedPorts(POSTGRES_PORT);
    // Bun has a bug with Wait.forListeningPorts() — use Docker healthcheck instead.
    // pg_isready connects via Unix socket by default (local), bypassing SSL requirement.
    this.withHealthCheck({
      test: ["CMD-SHELL", "pg_isready -U postgres"],
      interval: 1_000,
      timeout: 5_000,
      retries: 10,
    });
    this.withWaitStrategy(Wait.forHealthCheck());
    this.withStartupTimeout(30_000);
    this.withTmpFs({
      // PostgreSQL 18 stores data under /var/lib/postgresql/<major>/docker instead of /data
      "/var/lib/postgresql": "rw,noexec,nosuid,size=256m",
    });
    // Copy certificates into container (more portable than bind mounts)
    const certDir = dirname(certificates.caCert);
    this.withCopyDirectoriesToContainer([
      {
        source: certDir,
        target: "/certs",
      },
    ]);
  }

  public override async start(): Promise<StartedPostgresSslContainer> {
    this.withEnvironment({
      POSTGRES_DB: this.database,
      POSTGRES_USER: this.username,
      POSTGRES_PASSWORD: this.password,
    });

    // Copy certificates to /var/lib/postgresql/ (like the tutorial)
    const serverCertName = this.serverCertName;
    const serverKeyName = this.serverKeyName;

    // Create init script that runs during database initialization
    // This runs AFTER the data directory is created but BEFORE PostgreSQL accepts connections
    const initScript = `#!/bin/bash
set -e
# Configure pg_hba.conf to require SSL for TCP connections
# Allow local Unix socket connections (for psql commands inside container)
cat > "$PGDATA/pg_hba.conf" <<EOF
# Allow local Unix socket connections (for psql commands inside container)
local all all scram-sha-256
# Require SSL for all TCP connections
hostssl all all 0.0.0.0/0 scram-sha-256
hostssl all all ::/0 scram-sha-256
EOF
`;

    // Copy init script into container (runs during docker-entrypoint.sh initialization)
    this.withCopyContentToContainer([
      {
        content: initScript,
        target: "/docker-entrypoint-initdb.d/01-ssl-setup.sh",
        mode: 0o755,
      },
    ]);

    // Wrapper script that copies certs and starts PostgreSQL
    const setupScript = `#!/bin/sh
set -e
# Copy certificates to /var/lib/postgresql/ (accessible before data dir exists)
cp "/certs/${serverCertName}" /var/lib/postgresql/server.crt
cp "/certs/${serverKeyName}" /var/lib/postgresql/server.key
chmod 600 /var/lib/postgresql/server.key
chmod 644 /var/lib/postgresql/server.crt
chown postgres:postgres /var/lib/postgresql/server.key /var/lib/postgresql/server.crt
# Start PostgreSQL with SSL enabled via command-line args (like tutorial)
exec docker-entrypoint.sh postgres \\
  -c wal_level=logical \\
  -c ssl=on \\
  -c ssl_cert_file=/var/lib/postgresql/server.crt \\
  -c ssl_key_file=/var/lib/postgresql/server.key
`;

    this.withCopyContentToContainer([
      {
        content: setupScript,
        target: "/docker-entrypoint-ssl.sh",
        mode: 0o755,
      },
    ]);

    // Use our custom entrypoint script
    this.withCommand(["/docker-entrypoint-ssl.sh"]);

    return new StartedPostgresSslContainer(
      await super.start(),
      this.database,
      this.username,
      this.password,
      this.certificates,
    );
  }
}

class StartedPostgresSslContainer extends AbstractStartedContainer {
  private readonly database: string;
  private readonly username: string;
  private readonly password: string;
  private readonly certificates: SslCertificates;

  constructor(
    startedTestContainer: StartedTestContainer,
    database: string,
    username: string,
    password: string,
    certificates: SslCertificates,
  ) {
    super(startedTestContainer);
    this.database = database;
    this.username = username;
    this.password = password;
    this.certificates = certificates;
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

  public getCertificates(): SslCertificates {
    return this.certificates;
  }

  /**
   * @returns A connection URI in the form of `postgres[ql]://[username[:password]@][host[:port],]/database`
   */
  public getConnectionUri(): string {
    const url = new URL("", "postgres://");
    url.hostname = this.getHost();
    url.port = this.getPort().toString();
    url.pathname = this.database;
    url.username = this.username;
    url.password = this.password;
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
    url.username = this.username;
    url.password = this.password;
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
    await this.execCommandsSQL([
      `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
    ]);
  }

  /**
   * Executes a series of SQL commands against the Postgres database
   */
  private async execCommandsSQL(
    commands: string[],
    database: string = "postgres",
  ): Promise<void> {
    for (const command of commands) {
      try {
        const result = await this.exec(
          [
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            this.username,
            "-d",
            database,
            "-c",
            command,
          ],
          {
            env: {
              PGPASSWORD: this.password,
            },
          },
        );

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
