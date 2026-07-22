/**
 * Regression (surfaced by the platform dbmate dogfood, PR #35283): rendered
 * migration files must NOT pin `search_path = pg_catalog`.
 *
 * pg-delta's rendered DDL is already fully schema-qualified, so the pin is
 * redundant for the migration statements themselves. But a third-party
 * migration runner (dbmate — the platform's production deploy path) appends its
 * OWN bookkeeping (`INSERT INTO schema_migrations ...`, UNqualified) inside the
 * SAME transaction as the migration file. If the file pins
 * `search_path = pg_catalog`, that unqualified insert resolves against
 * `pg_catalog` (where `schema_migrations` does not exist) and every
 * pg-delta migration dbmate applies fails.
 *
 * apply() keeps pinning search_path on its OWN connection (it runs no
 * third-party bookkeeping) — pinned via the plan preamble, asserted below.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderPlanFiles } from "../src/frontends/render-plan-files.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

describe("rendered migration files replay under a third-party runner (dbmate)", () => {
  let empty: TestDb;
  let populated: TestDb;
  let target: TestDb;

  beforeAll(async () => {
    empty = await createTestDb("dbmate_empty");
    populated = await createTestDb("dbmate_pop");
    target = await createTestDb("dbmate_target");
    await populated.pool.query(/* sql */ `
      CREATE SCHEMA app;
      CREATE TABLE public.widgets (id integer PRIMARY KEY, name text);
      CREATE TABLE app.gadgets (id integer PRIMARY KEY);
    `);
  }, 120_000);

  afterAll(async () => {
    await Promise.all([empty.drop(), populated.drop(), target.drop()]);
  });

  test("rendered file + unqualified schema_migrations INSERT commit in one transaction", async () => {
    const from = await extract(empty.pool);
    const to = await extract(populated.pool);
    const p = plan(from.factBase, to.factBase);

    // The plan preamble (consumed unchanged by apply() on its own connection)
    // still pins search_path — the render path is where it must be dropped.
    expect(p.preamble).toContainEqual({
      name: "search_path",
      value: "pg_catalog",
    });
    expect(p.preamble).toContainEqual({
      name: "check_function_bodies",
      value: "off",
    });

    const rendered = renderPlanFiles(p, { allowDrops: false });
    expect(rendered.files).toHaveLength(1);
    const file = rendered.files[0]!;
    expect(file.transactional).toBe(true);
    // shape: no search_path pin; check_function_bodies is retained.
    expect(file.contents).not.toContain("search_path");
    expect(file.contents).toContain("set local check_function_bodies = off;");

    // Simulate dbmate: create the bookkeeping table, then run the migration
    // file body followed by dbmate's own UNqualified INSERT — all in ONE
    // transaction, exactly as dbmate does.
    await target.pool.query(
      `CREATE TABLE public.schema_migrations (version text PRIMARY KEY)`,
    );
    const client = await target.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(file.contents);
      // dbmate's bookkeeping insert — UNqualified, resolves via search_path.
      // Pre-fix this fails: `relation "schema_migrations" does not exist`.
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ('001')",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    // The migration applied AND the bookkeeping row landed.
    const widgets = await target.pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'widgets'`,
    );
    expect(widgets.rowCount).toBe(1);
    const bookkeeping = await target.pool.query(
      `SELECT version FROM public.schema_migrations`,
    );
    expect(bookkeeping.rows).toEqual([{ version: "001" }]);
  });
});
