/**
 * Declarative-export SQL formatting (opt-in, layout-agnostic).
 *
 * `exportSqlFiles(fb, { format })` runs each file's statements through the
 * ported SQL formatter (frontends/sql-format) before joining. It is OFF by
 * default (output stays exactly as the renderer emits it) and works with any
 * layout. The formatter is a heuristic token reformatter, so the load-bearing
 * safeguard is the fidelity gate: load(export(fb, { format })) ≡ fb — formatting
 * must never change a statement's meaning or drop one.
 *
 * Docker required (extracts + reloads against a real database).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaExport } from "../src/cli/commands/schema.ts";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { sharedCluster } from "./containers.ts";

const SCHEMA_SQL = `
  CREATE SCHEMA app;
  CREATE TABLE app.users (id integer PRIMARY KEY, email text NOT NULL);
  CREATE VIEW app.u AS SELECT id FROM app.users;
  CREATE FUNCTION app.add(a integer, b integer) RETURNS integer
    LANGUAGE sql IMMUTABLE AS 'SELECT a + b';
  COMMENT ON TABLE app.users IS 'x';
`;

describe("export: SQL formatting", () => {
  test("off by default; --format-options applies keyword casing", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expfmt_case");
    try {
      await src.pool.query(SCHEMA_SQL);
      const fb = (await extract(src.pool)).factBase;

      const tableOf = (files: { name: string; sql: string }[]) =>
        files.find((f) => f.name === "app/tables/users.sql")?.sql ?? "";

      // default: unformatted — the renderer emits upper-case DDL keywords
      const plain = tableOf(exportSqlFiles(fb));
      expect(plain).toContain("CREATE TABLE");

      // formatted with keywordCase lower: the same statement is lower-cased
      const lowered = tableOf(
        exportSqlFiles(fb, { format: { keywordCase: "lower" } }),
      );
      expect(lowered).toContain("create table");
      expect(lowered).not.toContain("CREATE TABLE");
    } finally {
      await src.drop();
    }
  }, 60_000);

  // CLI contract: `schema export` is a HUMAN-FACING artifact, so it formats by
  // default (lowercase keywords, formatter defaults otherwise). --format-options
  // still overrides any knob; --no-format restores the raw renderer output.
  test("schema export CLI formats by default (lowercase); --no-format opts out", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expfmt_cli");
    try {
      await src.pool.query(SCHEMA_SQL);

      const defaultDir = join(mkdtempSync(join(tmpdir(), "expfmt-")), "d");
      await cmdSchemaExport(["--source", src.uri, "--out-dir", defaultDir]);
      const formatted = readFileSync(
        join(defaultDir, "app/tables/users.sql"),
        "utf8",
      );
      expect(formatted).toContain("create table");
      expect(formatted).not.toContain("CREATE TABLE");

      const rawDir = join(mkdtempSync(join(tmpdir(), "expfmt-")), "r");
      await cmdSchemaExport([
        "--source",
        src.uri,
        "--out-dir",
        rawDir,
        "--no-format",
      ]);
      const raw = readFileSync(join(rawDir, "app/tables/users.sql"), "utf8");
      expect(raw).toContain("CREATE TABLE");
    } finally {
      await src.drop();
    }
  }, 120_000);

  test("load(export(fb, { format })) is hash-identical (fidelity gate)", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expfmt_fid_src");
    const shadow = await cluster.createDb("expfmt_fid_shadow");
    try {
      await src.pool.query(SCHEMA_SQL);
      const fb = (await extract(src.pool)).factBase;

      const formatted = exportSqlFiles(fb, {
        format: { keywordCase: "upper", maxWidth: 80 },
      }).filter((f) => !f.name.startsWith("_cluster/roles"));

      const loaded = await loadSqlFiles(formatted, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await Promise.all([src.drop(), shadow.drop()]);
    }
  }, 120_000);
});
