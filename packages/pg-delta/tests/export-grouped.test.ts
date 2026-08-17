/**
 * Grouped declarative-export layout (v1 parity, opt-in).
 *
 * `layout: "grouped"` brings back the old engine's "nice" export: files ordered
 * by a fixed semantic category priority (not raw plan order), statements sorted
 * within a file for readability, plus opt-in grouping by name pattern, flat
 * schemas, and partition-with-parent grouping. The default layouts
 * (`by-object`, `ordered`) are unchanged — pinned by export.test.ts /
 * export-layout.test.ts.
 *
 * Fidelity (load(export(fb, "grouped")) ≡ fb) is still the gate: grouped files
 * may need the loader's retry rounds, but must reproduce the exact fact base.
 *
 * Docker required (extracts from a real database).
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { sharedCluster } from "./containers.ts";

describe("export: grouped layout (v1 parity)", () => {
  test("orders files by semantic category, not dependency/plan order", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expgrp_cat");
    try {
      // the view depends on the function, so PLAN order is function-before-view;
      // category order is the opposite (views < functions), which is what the
      // grouped layout must follow.
      await src.pool.query(`
        CREATE SCHEMA app;
        CREATE FUNCTION app.f() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1';
        CREATE VIEW app.v AS SELECT app.f() AS n;
      `);
      const fb = (await extract(src.pool)).factBase;
      const names = exportSqlFiles(fb, { layout: "grouped" }).map(
        (f) => f.name,
      );

      const viewAt = names.indexOf("app/views/v.sql");
      const fnAt = names.indexOf("app/functions/f.sql");
      expect(viewAt).toBeGreaterThanOrEqual(0);
      expect(fnAt).toBeGreaterThanOrEqual(0);
      expect(viewAt).toBeLessThan(fnAt);
    } finally {
      await src.drop();
    }
  }, 60_000);

  test("sorts statements within a file for readability (object before comment)", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expgrp_read");
    try {
      await src.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer PRIMARY KEY);
        COMMENT ON TABLE app.t IS 'hello';
      `);
      const fb = (await extract(src.pool)).factBase;
      const files = exportSqlFiles(fb, { layout: "grouped" });
      const tableFile = files.find((f) => f.name === "app/tables/t.sql");
      expect(tableFile).toBeDefined();
      const sql = tableFile?.sql ?? "";
      expect(sql).toContain("CREATE TABLE");
      expect(sql).toContain("COMMENT ON");
      expect(sql.indexOf("CREATE TABLE")).toBeLessThan(
        sql.indexOf("COMMENT ON"),
      );
    } finally {
      await src.drop();
    }
  }, 60_000);

  test("groups objects by name pattern into a subdirectory", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expgrp_pat");
    try {
      await src.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.auth_users (id integer PRIMARY KEY);
        CREATE TABLE app.auth_sessions (id integer PRIMARY KEY);
        CREATE TABLE app.billing_invoices (id integer PRIMARY KEY);
      `);
      const fb = (await extract(src.pool)).factBase;
      const names = exportSqlFiles(fb, {
        layout: "grouped",
        grouping: {
          mode: "subdirectory",
          groupPatterns: [{ pattern: "^auth_", name: "auth" }],
        },
      }).map((f) => f.name);

      // both auth_* tables consolidate under the auth group…
      expect(names).toContain("app/auth/tables.sql");
      expect(names).not.toContain("app/tables/auth_users.sql");
      expect(names).not.toContain("app/tables/auth_sessions.sql");
      // …the non-matching table keeps its own per-object file
      expect(names).toContain("app/tables/billing_invoices.sql");
    } finally {
      await src.drop();
    }
  }, 60_000);

  test("flattens a schema into one file per category", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expgrp_flat");
    try {
      await src.pool.query(`
        CREATE SCHEMA ext;
        CREATE TABLE ext.a (id integer PRIMARY KEY);
        CREATE TABLE ext.b (id integer PRIMARY KEY);
      `);
      const fb = (await extract(src.pool)).factBase;
      const files = exportSqlFiles(fb, {
        layout: "grouped",
        grouping: { flatSchemas: ["ext"] },
      });
      const names = files.map((f) => f.name);
      expect(names).toContain("ext/tables.sql");
      expect(names).not.toContain("ext/tables/a.sql");
      const flat = files.find((f) => f.name === "ext/tables.sql");
      expect(flat?.sql).toContain('"ext"."a"');
      expect(flat?.sql).toContain('"ext"."b"');
    } finally {
      await src.drop();
    }
  }, 60_000);

  test("groups a partition child into its parent's file (default on under grouped)", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expgrp_part");
    try {
      await src.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.measurements (id integer, ts date) PARTITION BY RANGE (ts);
        CREATE TABLE app.measurements_2024 PARTITION OF app.measurements
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      `);
      const fb = (await extract(src.pool)).factBase;
      const files = exportSqlFiles(fb, { layout: "grouped" });
      const names = files.map((f) => f.name);

      // the child does NOT get its own file (the by-object contract); it lands
      // in the parent's file
      expect(names).not.toContain("app/tables/measurements_2024.sql");
      const parentFile = files.find(
        (f) => f.name === "app/tables/measurements.sql",
      );
      expect(parentFile?.sql).toContain("measurements_2024");
      expect(parentFile?.sql).toContain("PARTITION OF");
    } finally {
      await src.drop();
    }
  }, 60_000);

  test('pathStyle "nested" keeps the historical grouped paths', async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expgrp_nested");
    try {
      await src.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.auth_users (id integer PRIMARY KEY);
        CREATE TABLE app.billing_invoices (id integer PRIMARY KEY);
      `);
      const fb = (await extract(src.pool)).factBase;
      const names = exportSqlFiles(fb, {
        layout: "grouped",
        pathStyle: "nested",
        grouping: {
          mode: "subdirectory",
          groupPatterns: [{ pattern: "^auth_", name: "auth" }],
        },
      }).map((f) => f.name);

      expect(names).toContain("schemas/app/auth/tables.sql");
      expect(names).toContain("schemas/app/tables/billing_invoices.sql");
      expect(names.some((n) => n.startsWith("_cluster/"))).toBe(false);
    } finally {
      await src.drop();
    }
  }, 60_000);

  test("load(export(fb, grouped)) is hash-identical (fidelity gate)", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expgrp_fid_src");
    const shadow = await cluster.createDb("expgrp_fid_shadow");
    try {
      await src.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.lvl AS ENUM ('low', 'high');
        CREATE TABLE app.users (id integer PRIMARY KEY, lvl app.lvl);
        CREATE VIEW app.u AS SELECT id FROM app.users;
        CREATE FUNCTION app.f() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1';
        COMMENT ON TABLE app.users IS 'x';
      `);
      const fb = (await extract(src.pool)).factBase;
      const grouped = exportSqlFiles(fb, { layout: "grouped" }).filter(
        (f) => !f.name.startsWith("_cluster/roles"),
      );
      const loaded = await loadSqlFiles(grouped, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await Promise.all([src.drop(), shadow.drop()]);
    }
  }, 120_000);
});
