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
 * Deliberate v2 invariant (round-trip fidelity, export-fidelity.test.ts): ONLY
 * an FK that participates in a cross-table reference CYCLE (mutual FKs) moves to
 * a sibling `<table>.fk.sql` — files apply atomically, so a cyclic pair inline
 * would deadlock the loader. Acyclic FKs (the overwhelmingly common case) stay
 * inline in their table's file for readability; the loader's bounded retry
 * orders them. Still no `foreign_keys/` directory.
 *
 * Restored old-engine behaviors (readability, by user decision — the earlier
 * v2 one-category-per-file rule was reversed):
 *   - indexes CO-LOCATE with their table / matview file (no indexes/ dir);
 *   - satellites of a VIEW (INSTEAD OF triggers, policies) file with the view,
 *     not under tables/ (relation-kind-aware routing);
 *   - ACL/comment satellites on EXTENSION MEMBERS file with their extension.
 * Still deliberate v2 delta: materialized views live under
 * materialized_views/ (old: matviews/).
 *
 * Layout-dependent (second test): a partition child is its OWN tables/<child>.sql
 * file in the by-object layout, but the v1-parity "grouped" layout co-locates it
 * into the parent table's file (autoGroupPartitions) — matching the old engine's
 * "partitioned tables" behavior. That case is ported.
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
        -- mutual FK pair: the ONLY case whose FKs move to sibling .fk.sql files
        CREATE TABLE test_schema.m1 (id integer PRIMARY KEY, m2_id integer);
        CREATE TABLE test_schema.m2 (id integer PRIMARY KEY, m1_id integer);
        ALTER TABLE test_schema.m1
          ADD CONSTRAINT m1_m2_fk FOREIGN KEY (m2_id) REFERENCES test_schema.m2(id);
        ALTER TABLE test_schema.m2
          ADD CONSTRAINT m2_m1_fk FOREIGN KEY (m1_id) REFERENCES test_schema.m1(id);
        -- an ACL on an extension MEMBER (satellite-on-member routing)
        CREATE EXTENSION pgcrypto;
        REVOKE ALL ON FUNCTION public.gen_salt(text) FROM PUBLIC;
        -- a VIEW with an INSTEAD OF trigger (relation-kind-aware routing)
        CREATE VIEW test_schema.v_users AS SELECT id, name FROM test_schema.users;
        CREATE TRIGGER v_users_ins INSTEAD OF INSERT ON test_schema.v_users
          FOR EACH ROW EXECUTE FUNCTION test_schema.trigger_fn();
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
      // an ACYCLIC FK stays INLINE in the owning table's file (readability);
      // no separate foreign_keys/ dir and no sibling .fk.sql for it.
      expect(postsFile).toContain("REFERENCES");
      expect(postsFile).toContain("test_schema.users");
      expect(has("posts.fk.sql")).toBe(false);
      expect(has("foreign_keys/")).toBe(false);
      // a CYCLIC FK pair moves to sibling .fk.sql files (atomic files can't
      // hold a reference cycle), and the table files carry no REFERENCES.
      expect(byName.get("schemas/test_schema/tables/m1.fk.sql")).toContain(
        "m1_m2_fk",
      );
      expect(byName.get("schemas/test_schema/tables/m2.fk.sql")).toContain(
        "m2_m1_fk",
      );
      expect(byName.get("schemas/test_schema/tables/m1.sql")).not.toContain(
        "REFERENCES",
      );

      // a satellite whose TARGET is an extension MEMBER (an ACL on a pgcrypto
      // function) files into the owning extension's file, next to its CREATE
      // EXTENSION — NOT into schemas/<s>/functions/ (a real DB with pgTAP would
      // otherwise sprout hundreds of REVOKE-only function files).
      const pgcryptoFile = byName.get("cluster/extensions/pgcrypto.sql");
      expect(pgcryptoFile).toContain("CREATE EXTENSION");
      expect(pgcryptoFile).toContain("gen_salt");
      expect(has("functions/gen_salt")).toBe(false);
      // trigger + RLS policy in the table file, no separate dirs
      expect(usersFile).toContain("CREATE TRIGGER");
      expect(usersFile).toContain("users_trigger");
      expect(usersFile).toContain("CREATE POLICY");
      expect(usersFile).toContain("user_policy");
      expect(has("triggers/")).toBe(false);
      expect(has("policies/")).toBe(false);

      // indexes CO-LOCATE with their table (readability: the old engine did
      // this too; the earlier v2 one-category-per-file rule was reversed by
      // user decision) — no indexes/ directory at all.
      expect(usersFile).toContain("users_name_idx");
      expect(has("indexes/")).toBe(false);
      // matviews under materialized_views/ (old engine used matviews/), and a
      // matview's index co-locates with the matview file
      expect(
        byName.get("schemas/test_schema/materialized_views/user_summary.sql"),
      ).toContain("user_summary_idx");
      expect(has("matviews/")).toBe(false);
      // a trigger on a VIEW files with the view, not under tables/
      expect(byName.get("schemas/test_schema/views/v_users.sql")).toContain(
        "v_users_ins",
      );
      expect(has("tables/v_users")).toBe(false);
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

  test("grouped layout (v1 parity) co-locates partition children with the parent and indexes with their relation", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("explayout_grouped");
    try {
      await src.pool.query(`
        CREATE SCHEMA test_schema;
        CREATE TABLE test_schema.users (id integer PRIMARY KEY, name text NOT NULL);
        CREATE INDEX users_name_idx ON test_schema.users (name);
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
      const files = exportSqlFiles(fb, { layout: "grouped" });
      const byName = new Map(files.map((f) => [f.name, f.sql]));
      const has = (frag: string): boolean =>
        files.some((f) => f.name.includes(frag));

      // v1-parity win: a partition child is grouped INTO its parent table's
      // file (autoGroupPartitions), not emitted as a standalone file — this is
      // the old engine's "partitioned tables" behavior.
      expect(
        byName.get("schemas/test_schema/tables/measurements.sql"),
      ).toContain("measurements_2024");
      expect(has("tables/measurements_2024.sql")).toBe(false);

      // indexes co-locate with their table / matview file in grouped too
      // (old-engine behavior, restored by user decision) — no indexes/ dir.
      expect(byName.get("schemas/test_schema/tables/users.sql")).toContain(
        "users_name_idx",
      );
      expect(
        byName.get("schemas/test_schema/materialized_views/user_summary.sql"),
      ).toContain("user_summary_idx");
      expect(has("indexes/")).toBe(false);
      expect(has("matviews/")).toBe(false);
    } finally {
      await src.drop();
    }
  }, 120_000);
});
