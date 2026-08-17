import { describe, expect, test } from "bun:test";
import { classifyStatement } from "./index.ts";

describe("classifyStatement", () => {
  test("marks CREATE INDEX CONCURRENTLY as a barrier", () => {
    const c = classifyStatement(
      "CREATE UNIQUE INDEX CONCURRENTLY t_id ON t (id);",
      17,
    );
    expect(c.isBarrier).toBe(true);
    expect(c.barrierName).toBe("CREATE INDEX CONCURRENTLY");
  });

  test("marks VACUUM, CLUSTER, REINDEX CONCURRENTLY as barriers", () => {
    expect(classifyStatement("VACUUM ANALYZE t;", 16).isBarrier).toBe(true);
    expect(classifyStatement("CLUSTER t;", 14).isBarrier).toBe(true);
    expect(
      classifyStatement("REINDEX TABLE CONCURRENTLY t;", 18).isBarrier,
    ).toBe(true);
  });

  test("does not treat ALTER TYPE ADD VALUE as a barrier on PG 14–18", () => {
    expect(
      classifyStatement("ALTER TYPE mood ADD VALUE 'sad';", 14).isBarrier,
    ).toBe(false);
  });

  test("refuses tablespaces, ALTER SYSTEM, CREATE DATABASE, and replication DDL", () => {
    expect(
      classifyStatement("CREATE TABLESPACE ts LOCATION '/x';", 17).refused,
    ).toBe(true);
    expect(
      classifyStatement("ALTER SYSTEM SET wal_level = logical;", 17).refused,
    ).toBe(true);
    expect(classifyStatement("CREATE DATABASE d;", 17).refused).toBe(true);
    expect(
      classifyStatement(
        "CREATE SUBSCRIPTION s CONNECTION 'x' PUBLICATION p;",
        17,
      ).refused,
    ).toBe(true);
    expect(classifyStatement("CREATE TABLE t (id int);", 17).refused).toBe(
      false,
    );
  });

  test("hints cluster-scope for roles and membership GRANTs, not privilege GRANTs", () => {
    expect(classifyStatement("CREATE ROLE app;", 17).clusterScope).toBe(true);
    expect(classifyStatement("GRANT app TO postgres;", 17).clusterScope).toBe(
      true,
    );
    expect(
      classifyStatement("GRANT SELECT ON TABLE t TO app;", 17).clusterScope,
    ).toBe(false);
  });

  test("ignores barrier keywords inside comments", () => {
    expect(
      classifyStatement("-- VACUUM\nCREATE TABLE t (id int);", 17).isBarrier,
    ).toBe(false);
  });
});
