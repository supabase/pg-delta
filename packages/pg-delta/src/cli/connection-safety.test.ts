import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import {
  connectionEndpointHash,
  databaseIdentityStamp,
  isDatabaseIdentityObservationUnavailable,
  isSameDatabase,
  isSamePostgresLineage,
  isTrustedLocalConnection,
  type ObservedDatabaseIdentity,
  observeDatabaseIdentityForMutation,
} from "./connection-safety.ts";

describe("connection safety", () => {
  const identity = (
    database: string,
    databaseOid: string,
    overrides: Partial<ObservedDatabaseIdentity> = {},
  ): ObservedDatabaseIdentity => ({
    database,
    databaseOid,
    systemIdentifier: "7612345678901234567",
    ...overrides,
  });

  test("recognizes built-in loopback endpoints", () => {
    expect(isTrustedLocalConnection("postgres://localhost/app", [])).toBe(true);
    expect(isTrustedLocalConnection("postgres://127.42.0.1/app", [])).toBe(
      true,
    );
    expect(isTrustedLocalConnection("postgres://[::1]/app", [])).toBe(true);
    expect(
      isTrustedLocalConnection(
        "postgres:///app?host=%2Fvar%2Frun%2Fpostgresql",
        [],
      ),
    ).toBe(true);
  });

  test("uses query host overrides exactly as pg does", () => {
    expect(
      isTrustedLocalConnection(
        "postgres://localhost/app?host=db.example.com",
        [],
      ),
    ).toBe(false);
    expect(
      isTrustedLocalConnection(
        "postgres://db.example.com/app?host=localhost",
        [],
      ),
    ).toBe(true);
  });

  test("rejects remote and merely private endpoints", () => {
    expect(isTrustedLocalConnection("postgres://db.example.com/app", [])).toBe(
      false,
    );
    expect(isTrustedLocalConnection("postgres://10.0.0.8/app", [])).toBe(false);
    expect(isTrustedLocalConnection("postgres://0.0.0.0/app", [])).toBe(false);
  });

  test("accepts an exact custom local host across dynamic ports", () => {
    const trusted = ["postgres.orb.local"];
    expect(
      isTrustedLocalConnection(
        "postgres://postgres.orb.local:5432/app",
        trusted,
      ),
    ).toBe(true);
    expect(
      isTrustedLocalConnection(
        "postgres://postgres.orb.local:6543/app",
        trusted,
      ),
    ).toBe(true);
    expect(
      isTrustedLocalConnection("postgres://other.orb.local:5432/app", trusted),
    ).toBe(false);
  });

  test("custom local hosts reject endpoint and wildcard syntax", () => {
    expect(() =>
      isTrustedLocalConnection("postgres://postgres.orb.local/app", [
        "postgres.orb.local:5432",
      ]),
    ).toThrow(/exact hostname/);
    expect(() =>
      isTrustedLocalConnection("postgres://postgres.orb.local/app", [
        "*.orb.local",
      ]),
    ).toThrow(/exact hostname/);
  });

  test("validates every trusted host even when locality is already established", () => {
    expect(() =>
      isTrustedLocalConnection("postgres://localhost/app", [
        "postgres.orb.local:5432",
      ]),
    ).toThrow(/exact hostname/);
    expect(() =>
      isTrustedLocalConnection("postgres://postgres.orb.local/app", [
        "postgres.orb.local",
        "*.orb.local",
      ]),
    ).toThrow(/exact hostname/);
  });

  test("rejects duplicate safety-sensitive query parameters", () => {
    for (const key of ["host", "port", "database"]) {
      expect(() =>
        isTrustedLocalConnection(
          `postgres://localhost/app?${key}=first&${key}=second`,
          [],
        ),
      ).toThrow(new RegExp(`duplicate.*${key}`, "i"));
    }
  });

  test("source endpoint hash ignores credentials but includes the database", () => {
    expect(
      connectionEndpointHash("postgres://alice:secret@db.example.com:5432/app"),
    ).toBe(connectionEndpointHash("postgres://bob:other@db.example.com/app"));
    expect(
      connectionEndpointHash("postgres://alice@db.example.com/another"),
    ).not.toBe(connectionEndpointHash("postgres://alice@db.example.com/app"));
  });

  test("source endpoint hash uses pg's effective host, port, and database", () => {
    expect(
      connectionEndpointHash(
        "postgres://authority.example:1111/app?host=query.example&port=2222",
      ),
    ).toBe(connectionEndpointHash("postgres://query.example:2222/app"));
    expect(
      connectionEndpointHash(
        "postgres://query.example:2222/app?database=ignored-by-pg",
      ),
    ).toBe(connectionEndpointHash("postgres://query.example:2222/app"));
    expect(
      connectionEndpointHash(
        "postgres:///app?host=%2Ftmp%2Fpostgres&port=6543",
      ),
    ).toBe(
      connectionEndpointHash(
        "postgres://ignored.example/app?host=%2Ftmp%2Fpostgres&port=6543",
      ),
    );
  });

  test("hashes lineage and database identity opaquely with separate domains", () => {
    const observed = identity("app", "16384");
    const stamp = databaseIdentityStamp(observed);

    expect(stamp).toEqual({
      scheme: "pg-system-identifier-v1",
      lineageHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      databaseHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(stamp.lineageHash).not.toBe(stamp.databaseHash);
    expect(JSON.stringify(stamp)).not.toContain(observed.systemIdentifier);
    expect(JSON.stringify(stamp)).not.toContain(observed.databaseOid);
    expect(databaseIdentityStamp(observed)).toEqual(stamp);
  });

  test("compares observed database and PostgreSQL lineage identity", () => {
    const target = identity("target", "16384");
    const same = identity("target", "16384");
    const sibling = identity("shadow", "16385");
    const isolated = identity("shadow", "16384", {
      systemIdentifier: "7699999999999999999",
    });

    expect(isSameDatabase(target, same)).toBe(true);
    expect(isSameDatabase(target, sibling)).toBe(false);
    expect(isSamePostgresLineage(target, sibling)).toBe(true);
    expect(isSamePostgresLineage(target, isolated)).toBe(false);
  });

  test("classifies only unavailable identity observations as recoverable", () => {
    expect(isDatabaseIdentityObservationUnavailable({ code: "42501" })).toBe(
      true,
    );
    expect(isDatabaseIdentityObservationUnavailable({ code: "42883" })).toBe(
      true,
    );
    expect(isDatabaseIdentityObservationUnavailable({ code: "08006" })).toBe(
      false,
    );
    expect(isDatabaseIdentityObservationUnavailable(new Error("boom"))).toBe(
      false,
    );
  });

  test("required mutation identity fails closed with grant remediation", async () => {
    const pool = {
      query: async () => {
        throw Object.assign(new Error("permission denied"), { code: "42501" });
      },
    } as unknown as Pool;

    expect(
      observeDatabaseIdentityForMutation(pool, "schema apply shadow safety"),
    ).rejects.toThrow(
      /GRANT EXECUTE ON FUNCTION pg_catalog\.pg_control_system\(\)/,
    );
  });

  test("missing pg_control_system is reported as unsupported, not grantable", async () => {
    const pool = {
      query: async () => {
        throw Object.assign(new Error("undefined function"), { code: "42883" });
      },
    } as unknown as Pool;

    let error: unknown;
    try {
      await observeDatabaseIdentityForMutation(
        pool,
        "schema apply target safety",
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/unavailable|unsupported/i);
    expect((error as Error).message).not.toContain("GRANT EXECUTE");
  });
});
