/**
 * loadSqlFiles DML rejection scope (P2 of the 2026-06-16 handoff review).
 *
 * The shadow loader rejects user DATA statements in declarative files by
 * observing whether any managed user table has rows after loading. "Managed
 * user table" must mean the SAME thing the diff path manages — so the check
 * reuses the extraction scope predicate AND excludes extension-owned relations.
 * Otherwise installing an extension whose CREATE EXTENSION / setup seeds its own
 * internal config table (here pg_partman's `part_config`) is wrongly rejected as
 * if the user wrote DML.
 *
 * Uses the Supabase image (ships pg_partman). The complementary "user DML is
 * still rejected" case is covered by tests/load-sql-files.test.ts (alpine).
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  loadSqlFiles,
  ShadowLoadError,
} from "../src/frontends/load-sql-files.ts";
import { supabaseCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("loadSqlFiles: extension-owned internal rows are not DML", () => {
  test("accepts declarative files that seed an extension's own config table", async () => {
    const cluster = await supabaseCluster();
    const shadow = await cluster.createDb("loadsql_ext_rows");
    dbs.push(shadow);

    // create_parent seeds a row into partman.part_config — an EXTENSION-owned
    // table (pg_depend deptype 'e'). Pre-fix, that row tripped the DML gate.
    const result = await loadSqlFiles(
      [
        { name: "0_schema.sql", sql: "CREATE SCHEMA partman;" },
        {
          name: "1_ext.sql",
          sql: "CREATE EXTENSION pg_partman WITH SCHEMA partman;",
        },
        {
          name: "2_parent.sql",
          sql: `CREATE TABLE public.events (
                    id bigint GENERATED ALWAYS AS IDENTITY,
                    created_at timestamptz NOT NULL
                  ) PARTITION BY RANGE (created_at);`,
        },
        {
          name: "3_create_parent.sql",
          sql: `SELECT partman.create_parent(
                    p_parent_table := 'public.events',
                    p_control := 'created_at',
                    p_interval := '1 day');`,
        },
      ],
      shadow.pool,
    );

    // the load succeeds: part_config rows are extension-owned, not user DML,
    // and the partitioned parent is captured as schema.
    expect(
      result.factBase.has({
        kind: "table",
        schema: "public",
        name: "events",
      }),
    ).toBe(true);
  }, 240_000);

  test("still rejects genuine user DML alongside an extension", async () => {
    const cluster = await supabaseCluster();
    const shadow = await cluster.createDb("loadsql_user_dml");
    dbs.push(shadow);

    const error = await loadSqlFiles(
      [
        { name: "0_schema.sql", sql: "CREATE SCHEMA partman;" },
        {
          name: "1_ext.sql",
          sql: "CREATE EXTENSION pg_partman WITH SCHEMA partman;",
        },
        {
          name: "2_user.sql",
          sql: "CREATE TABLE public.t (id int); INSERT INTO public.t VALUES (1);",
        },
      ],
      shadow.pool,
      // the DML gate is a warning by default; assert the fatal path still scopes
      // the rejection to the USER table and never to partman.part_config.
      { strictDataStatements: true },
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ShadowLoadError);
    expect(String(error)).toMatch(/data statements/);
    expect(String(error)).toMatch(/public/);
  }, 240_000);
});
