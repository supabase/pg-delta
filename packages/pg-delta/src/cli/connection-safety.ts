/**
 * Small, CLI-facing connection safety helpers.
 *
 * These checks prevent common endpoint mixups; they are not network-boundary
 * authentication. Logical state and database-identity gates still run before
 * any mutation.
 */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { parse as parseConnectionString } from "pg-connection-string";
import type { SourceDatabaseIdentity } from "../plan/plan.ts";

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

const SAFETY_SENSITIVE_QUERY_KEYS = new Set(["host", "port", "database"]);

function effectivePgValue(
  parsed: unknown,
  environmentName: "PGHOST" | "PGPORT" | "PGDATABASE" | "PGUSER",
  fallback?: string,
): string | undefined {
  if (typeof parsed === "string" && parsed !== "") return parsed;
  return process.env[environmentName] || fallback;
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

  const seenSafetyKeys = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (!SAFETY_SENSITIVE_QUERY_KEYS.has(key)) continue;
    if (seenSafetyKeys.has(key)) {
      throw new Error(
        `connection URL contains duplicate safety-sensitive query parameter: ${key}`,
      );
    }
    seenSafetyKeys.add(key);
  }

  let parsed: ReturnType<typeof parseConnectionString>;
  try {
    // This is the same parser `pg` uses for Pool({ connectionString }). In
    // particular, query host/port values override the URL authority while the
    // pathname remains the effective database.
    parsed = parseConnectionString(connectionString);
  } catch {
    throw new Error("connection URL is not a valid PostgreSQL URL");
  }

  const parsedUser = effectivePgValue(
    parsed.user,
    "PGUSER",
    process.platform === "win32" ? process.env.USERNAME : process.env.USER,
  );
  const database =
    effectivePgValue(parsed.database, "PGDATABASE") ?? parsedUser ?? "";
  const rawHost = effectivePgValue(parsed.host, "PGHOST", "localhost")!;
  const rawPort = effectivePgValue(parsed.port, "PGPORT", "5432")!;
  const effectivePort = Number.parseInt(rawPort, 10);
  if (Number.isNaN(effectivePort)) {
    throw new Error(`connection URL has an invalid port: ${rawPort}`);
  }
  const unixSocket = rawHost.startsWith("/");
  const host = unixSocket ? rawHost : normalizeHost(rawHost);

  return {
    host,
    port: String(effectivePort),
    database,
    unixSocket,
  };
}

function normalizeTrustedHost(value: string): string {
  // Reuse URL's host parsing, but accept only a bare, exact hostname. Ports are
  // intentionally excluded because local container runtimes commonly assign a
  // different forwarded port to each disposable database.
  let url: URL;
  try {
    url = new URL(`postgres://${value}/_`);
  } catch {
    throw new Error(
      `trusted local host must be an exact hostname (got ${value})`,
    );
  }
  if (
    value === "" ||
    value !== value.trim() ||
    value.includes("*") ||
    url.hostname === "" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/_" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      `trusted local host must be an exact hostname (got ${value})`,
    );
  }
  return normalizeHost(url.hostname);
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
  trustedHosts: readonly string[],
): boolean {
  const endpoint = parseConnectionEndpoint(connectionString);
  const normalizedTrustedHosts = trustedHosts.map(normalizeTrustedHost);
  if (endpoint.unixSocket) return true;
  if (
    endpoint.host === "localhost" ||
    endpoint.host === "::1" ||
    isIpv4Loopback(endpoint.host)
  ) {
    return true;
  }
  return normalizedTrustedHosts.includes(endpoint.host);
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
  systemIdentifier: string;
}

/** Observe identity through PostgreSQL so URL aliases cannot hide same-DB use. */
export async function observeDatabaseIdentity(
  pool: Pool,
): Promise<ObservedDatabaseIdentity> {
  const result = await pool.query<ObservedDatabaseIdentity>(`
    SELECT current_database() AS database,
           d.oid::text AS "databaseOid",
           c.system_identifier::text AS "systemIdentifier"
      FROM pg_catalog.pg_database d
      CROSS JOIN pg_catalog.pg_control_system() c
     WHERE d.datname = current_database()
  `);
  const identity = result.rows[0];
  if (identity === undefined) {
    throw new Error("could not observe the connected PostgreSQL database");
  }
  return identity;
}

export function databaseIdentityStamp(
  identity: ObservedDatabaseIdentity,
): SourceDatabaseIdentity {
  const hash = (domain: string, values: string[]): string =>
    createHash("sha256")
      .update(`${domain}\0${values.join("\0")}`)
      .digest("hex");
  return {
    scheme: "pg-system-identifier-v1",
    lineageHash: hash("pgdelta:postgres-lineage:v1", [
      identity.systemIdentifier,
    ]),
    databaseHash: hash("pgdelta:postgres-database:v1", [
      identity.systemIdentifier,
      identity.databaseOid,
    ]),
  };
}

export function isDatabaseIdentityObservationUnavailable(
  error: unknown,
): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "42501" || code === "42883";
}

export async function observeDatabaseIdentityForMutation(
  pool: Pool,
  context: string,
): Promise<ObservedDatabaseIdentity> {
  try {
    return await observeDatabaseIdentity(pool);
  } catch (error) {
    if (!isDatabaseIdentityObservationUnavailable(error)) throw error;
    const code = (error as { code?: unknown }).code;
    if (code === "42883") {
      throw new Error(
        `${context}: pg_catalog.pg_control_system() is unavailable; ` +
          `this PostgreSQL server cannot provide the lineage/database identity required for a mutating explicit-shadow workflow`,
        { cause: error },
      );
    }
    throw new Error(
      `${context}: could not observe the PostgreSQL lineage/database identity; ` +
        `grant the connection role access with GRANT EXECUTE ON FUNCTION ` +
        `pg_catalog.pg_control_system() TO <role>, then retry`,
      { cause: error },
    );
  }
}

export function isSamePostgresLineage(
  left: ObservedDatabaseIdentity,
  right: ObservedDatabaseIdentity,
): boolean {
  return left.systemIdentifier === right.systemIdentifier;
}

export function isSameDatabase(
  left: ObservedDatabaseIdentity,
  right: ObservedDatabaseIdentity,
): boolean {
  return (
    isSamePostgresLineage(left, right) && left.databaseOid === right.databaseOid
  );
}
