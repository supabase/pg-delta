/**
 * Export by-object layout parity (Tier 6): the old engine's
 * declarative-schema-export suite pinned WHICH file each object's DDL lands in.
 * The v2 exporter (frontends/export-sql-files.ts) keeps the parts that mattered
 * and deliberately changes a few. This test is the canonical record of the v2
 * by-object layout contract so it cannot silently regress.
 *
 * Preserved from the old engine (its tests asserted these and still hold):
 *   - FK constraints render INTO the owning table's file (no foreign_keys/ dir);
 *   - triggers render INTO the table's file (no triggers/ dir);
 *   - RLS policies render INTO the table's file (no policies/ dir).
 *
 * Deliberate v2 deltas (the old tests asserted the opposite — recorded as
 * not-ported in the porting ledger, pinned here as the v2 behavior):
 *   - indexes get their OWN file under schemas/<s>/indexes/<name>.sql
 *     (old engine co-located them in the table / matview file);
 *   - materialized views live under materialized_views/ (old: matviews/);
 *   - a partition child is its OWN tables/<child>.sql file
 *     (old engine grouped the child into the parent table's file).
 *
 * Fidelity (load(export(fb)) ≡ fb) and the ordered-layout zero-round gate are
 * covered by export.test.ts; this file only pins the file MAPPING.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { sharedCluster } from "./containers.ts";

describe("export: by-object file mapping (v2 contract)", () => {
  test("table satellites co-locate; indexes/matviews/partitions get their own paths", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("explayout_src");
    try {
      await src.pool.query(`
        CREATE SCHEMA test_schema;
        CREATE TABLE test_schema.users (
          id integer PRIMARY KEY,
          name text NOT NULL,
          owner_id integer
        );
        CREATE INDEX users_name_idx ON test_schema.users (name);
        CREATE TABLE test_schema.posts (
          id integer PRIMARY KEY,
          user_id integer REFERENCES test_schema.users(id)
        );
        ALTER TABLE test_schema.users ENABLE ROW LEVEL SECURITY;
        CREATE POLICY user_policy ON test_schema.users
          FOR SELECT USING (owner_id = 1);
        CREATE FUNCTION test_schema.trigger_fn() RETURNS trigger
          AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER users_trigger
          BEFORE INSERT ON test_schema.users
          FOR EACH ROW EXECUTE FUNCTION test_schema.trigger_fn();
        CREATE TABLE test_schema.measurements (id integer, date date)
          PARTITION BY RANGE (date);
        CREATE TABLE test_schema.measurements_2024
          PARTITION OF test_schema.measurements
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        CREATE MATERIALIZED VIEW test_schema.user_summary AS
          SELECT id FROM test_schema.users;
        CREATE INDEX user_summary_idx ON test_schema.user_summary (id);
      `);
      const fb = (await extract(src.pool)).factBase;
      const files = exportSqlFiles(fb);
      const byName = new Map(files.map((f) => [f.name, f.sql]));
      const has = (frag: string): boolean =>
        files.some((f) => f.name.includes(frag));

      // --- preserved co-location (old declarative-schema-export intent) ---
      const usersFile = byName.get("schemas/test_schema/tables/users.sql");
      const postsFile = byName.get("schemas/test_schema/tables/posts.sql");
      expect(usersFile).toBeDefined();
      expect(postsFile).toBeDefined();
      // FK constraint in the owning table file, no separate foreign_keys/ dir
      expect(postsFile).toContain("REFERENCES");
      expect(postsFile).toContain("test_schema.users");
      expect(has("foreign_keys/")).toBe(false);
      // trigger + RLS policy in the table file, no separate dirs
      expect(usersFile).toContain("CREATE TRIGGER");
      expect(usersFile).toContain("users_trigger");
      expect(usersFile).toContain("CREATE POLICY");
      expect(usersFile).toContain("user_policy");
      expect(has("triggers/")).toBe(false);
      expect(has("policies/")).toBe(false);

      // --- deliberate v2 deltas vs the old engine ---
      // indexes get their OWN file (old engine put them in the table file)
      expect(
        byName.get("schemas/test_schema/indexes/users_name_idx.sql"),
      ).toContain("users_name_idx");
      expect(usersFile).not.toContain("users_name_idx");
      // matviews under materialized_views/ (old engine used matviews/)
      expect(
        has("schemas/test_schema/materialized_views/user_summary.sql"),
      ).toBe(true);
      expect(has("matviews/")).toBe(false);
      // a matview's index is also its own file under indexes/
      expect(
        byName.get("schemas/test_schema/indexes/user_summary_idx.sql"),
      ).toContain("user_summary_idx");
      // a partition child is its OWN table file (old engine grouped it)
      expect(has("schemas/test_schema/tables/measurements.sql")).toBe(true);
      expect(has("schemas/test_schema/tables/measurements_2024.sql")).toBe(
        true,
      );
      const parentFile = byName.get(
        "schemas/test_schema/tables/measurements.sql",
      );
      expect(parentFile).not.toContain("measurements_2024");
    } finally {
      await src.drop();
    }
  }, 120_000);
});
