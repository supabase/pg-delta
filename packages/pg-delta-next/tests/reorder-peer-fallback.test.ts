/**
 * `schema apply` enables the reorder assist by default, but the assist's
 * `@supabase/pg-topo` dependency is an OPTIONAL peer. When it is absent,
 * `analyzeForShadow` throws `ReorderUnavailableError`; the CLI must catch that
 * and fall back to raw, file-granular loading (with a warning) instead of
 * failing the whole apply (review P2). Exercised in-process via the pg-topo
 * importer test seam, since a spawned CLI can't simulate the missing peer.
 *
 * Docker required.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdSchemaApply } from "../src/cli/commands/schema.ts";
import { __setPgTopoImporterForTests } from "../src/frontends/sql-order.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});
afterEach(() => __setPgTopoImporterForTests(null));

describe("schema apply: optional pg-topo peer absent", () => {
  test("falls back to raw loading and still applies", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("reorder_peer_shadow");
    const target = await cluster.createDb("reorder_peer_tgt");
    dbs.push(shadow, target);

    const dir = join(tmpdir(), `pg-delta-next-reorder-peer-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "01_schema.sql"), `CREATE SCHEMA clitest;\n`);
    writeFileSync(
      join(dir, "02_table.sql"),
      `CREATE TABLE clitest.items (id integer PRIMARY KEY);\n`,
    );

    // simulate the optional peer being uninstalled
    __setPgTopoImporterForTests(() => {
      throw new Error("Cannot find package '@supabase/pg-topo'");
    });

    // RED before the fix: the unguarded analyzeForShadow throws
    // ReorderUnavailableError and this rejects.
    await cmdSchemaApply([
      "--dir",
      dir,
      "--shadow",
      shadow.uri,
      "--target",
      target.uri,
      "--renames",
      "off",
    ]);

    const { rows } = await target.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'clitest'`,
    );
    expect(rows[0]?.n).toBe(1);
  }, 90_000);
});
