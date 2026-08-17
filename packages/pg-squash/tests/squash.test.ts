import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readChain } from "../src/ingest/index.ts";
import { squash } from "../src/squash.ts";
import { testClusterHandle, withLedgerLock } from "./containers.ts";
import type { ClusterHandle } from "../src/model/index.ts";

const corpusRoot = join(import.meta.dir, "corpus");

const isProof = (
  proof: unknown,
): proof is { equal: boolean; ledgerEqual: boolean } =>
  typeof proof === "object" &&
  proof !== null &&
  "equal" in proof &&
  typeof proof.equal === "boolean" &&
  "ledgerEqual" in proof &&
  typeof proof.ledgerEqual === "boolean";

describe("corpus: squash proof loop", () => {
  let handle: ClusterHandle;

  beforeAll(async () => {
    handle = await testClusterHandle();
  }, 60_000);

  afterAll(async () => {
    // Cluster is a process singleton; Ryuk reaps the container.
  });

  test("discovers additive corpus scenarios", async () => {
    const entries = await readdir(corpusRoot, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(names).toContain("create-then-select");
    expect(names).toContain("dml-backfill");
    expect(names).toContain("create-role-grant");
    expect(names).toContain("explicit-begin-commit");
    expect(names).toContain("create-then-drop");
    expect(names).toContain("enum-add-then-use");
    expect(names).toContain("search-path-leak");
    expect(names).toContain("concurrent-index");
    expect(names).toContain("now-backfill");
    expect(names.length).toBeGreaterThanOrEqual(32);
  });

  test("proves each corpus scenario equivalent", async () => {
    const entries = await readdir(corpusRoot, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const expectedFiles: Record<string, number> = {
      "create-then-select": 1,
      "dml-backfill": 1,
      "create-role-grant": 1,
      "explicit-begin-commit": 1,
      "create-then-drop": 1,
      "search-path-leak": 2,
      "concurrent-index": 2,
      "concurrent-drop": 2,
      "refresh-mv-concurrent": 2,
      "now-backfill": 1,
    };
    const needsMask = new Set(["now-backfill", "tenant-guc-now"]);
    await withLedgerLock(async () => {
      for (const name of names) {
        const chain = await readChain(join(corpusRoot, name));
        expect(chain.length).toBeGreaterThan(0);
        const result = await squash(chain, {
          cluster: handle,
          baselineDatabase: "template0",
          skipVolatilityMask: !needsMask.has(name),
        });
        expect(isProof(result.proof)).toBe(true);
        if (!isProof(result.proof)) return;
        expect(result.proof.equal, name).toBe(true);
        expect(
          result.diagnostics.filter((d) => d.code === "refused-statement"),
        ).toEqual([]);
        const want = expectedFiles[name];
        if (want !== undefined) {
          expect(result.files.length, name).toBe(want);
        }
        if (name === "search-path-leak" || name === "tenant-guc-now") {
          expect(
            result.diagnostics.some((d) => d.code === "repair-split"),
            name,
          ).toBe(true);
        }
      }
    });
  }, 360_000);

  test("100-file synthetic chain squashes to 1 file and proves", async () => {
    const chain = Array.from({ length: 100 }, (_, i) => ({
      name: `${String(i + 1).padStart(4, "0")}_t.sql`,
      sql: `CREATE TABLE t_${i} (id int PRIMARY KEY);`,
    }));
    await withLedgerLock(async () => {
      const result = await squash(chain, {
        cluster: handle,
        baselineDatabase: "template0",
        skipVolatilityMask: true,
      });
      expect(result.files).toHaveLength(1);
      expect(isProof(result.proof)).toBe(true);
      if (!isProof(result.proof)) return;
      expect(result.proof.equal).toBe(true);
    });
  }, 180_000);

  test("kill-switch: concurrent indexes stay at original file boundaries", async () => {
    const chain = [
      {
        name: "0001_table.sql",
        sql: "CREATE TABLE squash_kill (id int PRIMARY KEY);",
      },
      {
        name: "0002_i1.sql",
        sql: "CREATE INDEX CONCURRENTLY squash_kill_i1 ON squash_kill (id);",
      },
      {
        name: "0003_i2.sql",
        sql: "CREATE INDEX CONCURRENTLY squash_kill_i2 ON squash_kill (id);",
      },
      {
        name: "0004_i3.sql",
        sql: "CREATE INDEX CONCURRENTLY squash_kill_i3 ON squash_kill (id);",
      },
    ];
    await withLedgerLock(async () => {
      const result = await squash(chain, {
        cluster: handle,
        baselineDatabase: "template0",
        skipVolatilityMask: true,
      });
      expect(result.files).toHaveLength(chain.length);
      expect(isProof(result.proof)).toBe(true);
      if (!isProof(result.proof)) return;
      expect(result.proof.equal).toBe(true);
    });
  }, 120_000);

  test("refuses CREATE DATABASE before touching the cluster", async () => {
    const datname = "squash_should_not_exist";
    await withLedgerLock(async () => {
      const before = await handle.admin.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname = $1",
        [datname],
      );
      const result = await squash(
        [{ name: "0001_db.sql", sql: `CREATE DATABASE ${datname};` }],
        {
          cluster: handle,
          baselineDatabase: "template0",
          skipVolatilityMask: true,
        },
      );
      expect(
        result.diagnostics.some((d) => d.code === "refused-statement"),
      ).toBe(true);
      expect(isProof(result.proof)).toBe(true);
      if (!isProof(result.proof)) return;
      expect(result.proof.equal).toBe(false);
      const after = await handle.admin.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname = $1",
        [datname],
      );
      expect(after.rows).toEqual(before.rows);
    });
  }, 60_000);

  test("property: random contiguous splits of CREATE TABLE still prove", async () => {
    const rng = mulberry32(0x51a5e);
    await withLedgerLock(async () => {
      for (let iter = 0; iter < 20; iter += 1) {
        const tableCount = 8;
        const statements = Array.from(
          { length: tableCount },
          (_, i) =>
            `CREATE TABLE squash_prop_${iter}_${i} (id int PRIMARY KEY);`,
        );
        const fileCount = 2 + Math.floor(rng() * 5);
        const chain = partitionStatements(statements, fileCount, rng).map(
          (sql, i) => ({
            name: `${String(i + 1).padStart(4, "0")}_p.sql`,
            sql,
          }),
        );
        const result = await squash(chain, {
          cluster: handle,
          baselineDatabase: "template0",
          skipVolatilityMask: true,
        });
        expect(isProof(result.proof)).toBe(true);
        if (!isProof(result.proof)) return;
        expect(result.proof.equal, `iter ${String(iter)}`).toBe(true);
        expect(result.files.length).toBe(1);
      }
    });
  }, 180_000);
});

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const partitionStatements = (
  statements: string[],
  fileCount: number,
  rng: () => number,
): string[] => {
  const parts = Math.min(Math.max(1, fileCount), statements.length);
  const sizes = Array.from({ length: parts }, () => 1);
  let remaining = statements.length - parts;
  while (remaining > 0) {
    const idx = Math.floor(rng() * parts);
    const size = sizes[idx];
    if (size === undefined) break;
    sizes[idx] = size + 1;
    remaining -= 1;
  }
  const files: string[] = [];
  let offset = 0;
  for (const size of sizes) {
    files.push(statements.slice(offset, offset + size).join("\n"));
    offset += size;
  }
  return files;
};
