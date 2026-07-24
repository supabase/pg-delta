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

  test("rejects remote and merely private endpoints", () => {
    expect(isTrustedLocalConnection("postgres://db.example.com/app", [])).toBe(
      false,
    );
    expect(isTrustedLocalConnection("postgres://10.0.0.8/app", [])).toBe(false);
    expect(isTrustedLocalConnection("postgres://0.0.0.0/app", [])).toBe(false);
  });

  test("accepts an exact custom local endpoint without trusting other ports", () => {
    const trusted = ["postgres.orb.local:5432"];
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
    ).toBe(false);
  });

  test("source endpoint hash ignores credentials but includes the database", () => {
    expect(
      connectionEndpointHash("postgres://alice:secret@db.example.com:5432/app"),
    ).toBe(connectionEndpointHash("postgres://bob:other@db.example.com/app"));
    expect(
      connectionEndpointHash("postgres://alice@db.example.com/another"),
    ).not.toBe(connectionEndpointHash("postgres://alice@db.example.com/app"));
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
