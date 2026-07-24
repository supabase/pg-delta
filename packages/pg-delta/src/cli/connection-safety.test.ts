import { describe, expect, test } from "bun:test";
import {
  connectionEndpointHash,
  isSameDatabase,
  isSamePostgresCluster,
  isTrustedLocalConnection,
  type ObservedDatabaseIdentity,
} from "./connection-safety.ts";

describe("connection safety", () => {
  const identity = (
    database: string,
    databaseOid: string,
    overrides: Partial<ObservedDatabaseIdentity> = {},
  ): ObservedDatabaseIdentity => ({
    database,
    databaseOid,
    serverAddress: "127.0.0.1",
    serverPort: "5432",
    postmasterStartedAt: "123.456",
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

  test("compares observed database and cluster identity", () => {
    const target = identity("target", "16384");
    const same = identity("target", "16384");
    const sibling = identity("shadow", "16385");
    const isolated = identity("shadow", "16384", {
      serverAddress: "127.0.0.2",
      postmasterStartedAt: "789.012",
    });

    expect(isSameDatabase(target, same)).toBe(true);
    expect(isSameDatabase(target, sibling)).toBe(false);
    expect(isSamePostgresCluster(target, sibling)).toBe(true);
    expect(isSamePostgresCluster(target, isolated)).toBe(false);
  });
});
