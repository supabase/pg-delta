import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { SourceDatabaseIdentity } from "./plan/plan.ts";

export interface ObservedDatabaseIdentity {
  database: string;
  databaseOid: string;
  systemIdentifier: string;
}

export type DatabaseIdentityObservationUnavailableCode = "42501" | "42883";

/** Observe identity through PostgreSQL so transport aliases cannot hide a database. */
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
  return databaseIdentityObservationUnavailableCode(error) !== undefined;
}

export function databaseIdentityObservationUnavailableCode(
  error: unknown,
): DatabaseIdentityObservationUnavailableCode | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return code === "42501" || code === "42883" ? code : undefined;
}

/** Fail closed with connection-specific remediation for a mutating workflow. */
export async function observeDatabaseIdentityForMutation(
  pool: Pool,
  context: string,
): Promise<ObservedDatabaseIdentity> {
  try {
    return await observeDatabaseIdentity(pool);
  } catch (error) {
    const code = databaseIdentityObservationUnavailableCode(error);
    if (code === undefined) throw error;
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
