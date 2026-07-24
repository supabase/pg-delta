/**
 * Small, CLI-facing connection safety helpers.
 *
 * These checks prevent common endpoint mixups; they are not network-boundary
 * authentication. Logical state and database-identity gates still run before
 * any mutation.
 */
import { createHash } from "node:crypto";
import type { Pool } from "pg";

interface ConnectionEndpoint {
  host: string;
  port: string;
  database: string;
  unixSocket: boolean;
}

function normalizeHost(host: string): string {
  const unbracketed =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return unbracketed.toLowerCase().replace(/\.$/, "");
}

function parseConnectionEndpoint(connectionString: string): ConnectionEndpoint {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("connection URL is not a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `connection URL must use postgres:// or postgresql:// (got ${url.protocol})`,
    );
  }

  // libpq-style URLs may select a Unix socket through ?host=/path while the
  // authority is empty. The query parameter is the effective host in that form.
  const queryHost = url.searchParams.get("host");
  const unixSocket = queryHost?.startsWith("/") === true;
  const host = unixSocket
    ? queryHost
    : normalizeHost(
        queryHost && url.hostname === "" ? queryHost : url.hostname,
      );
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));

  return {
    host,
    port: url.port || "5432",
    database,
    unixSocket,
  };
}

function normalizeTrustedEndpoint(value: string): string {
  // Reuse URL's IPv6/port parsing and require a port so trust is scoped to one
  // concrete listener rather than every service on a custom hostname.
  let url: URL;
  try {
    url = new URL(`postgres://${value}/_`);
  } catch {
    throw new Error(
      `trusted local endpoint must be an exact host:port (got ${value})`,
    );
  }
  if (url.hostname === "" || url.port === "") {
    throw new Error(
      `trusted local endpoint must be an exact host:port (got ${value})`,
    );
  }
  return `${normalizeHost(url.hostname)}:${url.port}`;
}

function isIpv4Loopback(host: string): boolean {
  const parts = host.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) &&
    parts[0] === "127"
  );
}

export function isTrustedLocalConnection(
  connectionString: string,
  trustedEndpoints: readonly string[],
): boolean {
  const endpoint = parseConnectionEndpoint(connectionString);
  if (endpoint.unixSocket) return true;
  if (
    endpoint.host === "localhost" ||
    endpoint.host === "::1" ||
    isIpv4Loopback(endpoint.host)
  ) {
    return true;
  }
  const exact = `${endpoint.host}:${endpoint.port}`;
  return trustedEndpoints.some(
    (trusted) => normalizeTrustedEndpoint(trusted) === exact,
  );
}

/** Credential-free stable stamp used only to catch source-as-clone mistakes. */
export function connectionEndpointHash(connectionString: string): string {
  const endpoint = parseConnectionEndpoint(connectionString);
  return createHash("sha256")
    .update(
      `${endpoint.unixSocket ? "socket" : "tcp"}\0${endpoint.host}\0${endpoint.port}\0${endpoint.database}`,
    )
    .digest("hex");
}

export interface ObservedDatabaseIdentity {
  database: string;
  databaseOid: string;
  serverAddress: string | null;
  serverPort: string | null;
  postmasterStartedAt: string;
}

/** Observe identity through PostgreSQL so URL aliases cannot hide same-DB use. */
export async function observeDatabaseIdentity(
  pool: Pool,
): Promise<ObservedDatabaseIdentity> {
  const result = await pool.query<ObservedDatabaseIdentity>(`
    SELECT current_database() AS database,
           d.oid::text AS "databaseOid",
           inet_server_addr()::text AS "serverAddress",
           inet_server_port()::text AS "serverPort",
           extract(epoch FROM pg_postmaster_start_time())::text
             AS "postmasterStartedAt"
      FROM pg_database d
     WHERE d.datname = current_database()
  `);
  const identity = result.rows[0];
  if (identity === undefined) {
    throw new Error("could not observe the connected PostgreSQL database");
  }
  return identity;
}

export function isSamePostgresCluster(
  left: ObservedDatabaseIdentity,
  right: ObservedDatabaseIdentity,
): boolean {
  return (
    left.postmasterStartedAt === right.postmasterStartedAt &&
    left.serverAddress === right.serverAddress &&
    left.serverPort === right.serverPort
  );
}

export function isSameDatabase(
  left: ObservedDatabaseIdentity,
  right: ObservedDatabaseIdentity,
): boolean {
  return (
    isSamePostgresCluster(left, right) && left.databaseOid === right.databaseOid
  );
}
