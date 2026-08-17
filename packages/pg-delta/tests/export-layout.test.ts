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
      const usersFile = byName.get("test_schema/tables/users.sql");
      const postsFile = byName.get("test_schema/tables/posts.sql");
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
      expect(byName.get("test_schema/tables/m1.fk.sql")).toContain("m1_m2_fk");
      expect(byName.get("test_schema/tables/m2.fk.sql")).toContain("m2_m1_fk");
      expect(byName.get("test_schema/tables/m1.sql")).not.toContain(
        "REFERENCES",
      );

      // a satellite whose TARGET is an extension MEMBER (an ACL on a pgcrypto
      // function) files into the owning extension's file, next to its CREATE
      // EXTENSION — NOT into schemas/<s>/functions/ (a real DB with pgTAP would
      // otherwise sprout hundreds of REVOKE-only function files).
      const pgcryptoFile = byName.get("_cluster/extensions/pgcrypto.sql");
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
        byName.get("test_schema/materialized_views/user_summary.sql"),
      ).toContain("user_summary_idx");
      expect(has("matviews/")).toBe(false);
      // a trigger on a VIEW files with the view, not under tables/
      expect(byName.get("test_schema/views/v_users.sql")).toContain(
        "v_users_ins",
      );
      expect(has("tables/v_users")).toBe(false);
      // a partition child is its OWN table file (old engine grouped it)
      expect(has("test_schema/tables/measurements.sql")).toBe(true);
      expect(has("test_schema/tables/measurements_2024.sql")).toBe(true);
      const parentFile = byName.get("test_schema/tables/measurements.sql");
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
      expect(byName.get("test_schema/tables/measurements.sql")).toContain(
        "measurements_2024",
      );
      expect(has("tables/measurements_2024.sql")).toBe(false);

      // indexes co-locate with their table / matview file in grouped too
      // (old-engine behavior, restored by user decision) — no indexes/ dir.
      expect(byName.get("test_schema/tables/users.sql")).toContain(
        "users_name_idx",
      );
      expect(
        byName.get("test_schema/materialized_views/user_summary.sql"),
      ).toContain("user_summary_idx");
      expect(has("indexes/")).toBe(false);
      expect(has("matviews/")).toBe(false);
    } finally {
      await src.drop();
    }
  }, 120_000);
});

/**
 * `pathStyle` decides the two ROOT segments of every path, orthogonally to
 * `layout`:
 *   - "flat" (default): schema directories sit at the export root and the
 *     cluster-level files live in `_cluster/` — one less level of nesting for
 *     the tree users actually read and diff.
 *   - "nested": the historical `schemas/<s>/…` + `cluster/…` tree, kept as a
 *     back-compat escape hatch.
 * Everything BELOW the root segment is identical in both styles, so this suite
 * pins the roots (and the reserved-name escape) rather than re-pinning the
 * whole mapping the suite above already covers.
 */
describe("export: path style", () => {
  const SETUP = `
    CREATE SCHEMA app;
    CREATE TABLE app.t (id integer PRIMARY KEY);
    CREATE VIEW app.v AS SELECT id FROM app.t;
    CREATE FUNCTION app.f() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1';
    CREATE EXTENSION pgcrypto;
  `;

  test("flat is the default: schema dirs at the root, cluster files under _cluster/", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("exppath_flat");
    try {
      await src.pool.query(SETUP);
      const fb = (await extract(src.pool)).factBase;
      const names = exportSqlFiles(fb).map((f) => f.name);

      expect(names).toContain("app/schema.sql");
      expect(names).toContain("app/tables/t.sql");
      expect(names).toContain("app/views/v.sql");
      expect(names).toContain("app/functions/f.sql");
      expect(names).toContain("_cluster/roles.sql");
      expect(names).toContain("_cluster/extensions/pgcrypto.sql");
      // the `schemas/` wrapper and the un-prefixed `cluster/` dir are gone
      expect(names.some((n) => n.startsWith("schemas/"))).toBe(false);
      expect(names.some((n) => n.startsWith("cluster/"))).toBe(false);

      // explicit "flat" is the same thing as the default
      expect(
        exportSqlFiles(fb, { pathStyle: "flat" }).map((f) => f.name),
      ).toEqual(names);
    } finally {
      await src.drop();
    }
  }, 60_000);

  test('pathStyle "nested" reproduces the previous schemas/ + cluster/ tree', async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("exppath_nested");
    try {
      await src.pool.query(SETUP);
      const fb = (await extract(src.pool)).factBase;
      const names = exportSqlFiles(fb, { pathStyle: "nested" }).map(
        (f) => f.name,
      );

      expect(names).toContain("schemas/app/schema.sql");
      expect(names).toContain("schemas/app/tables/t.sql");
      expect(names).toContain("schemas/app/views/v.sql");
      expect(names).toContain("schemas/app/functions/f.sql");
      expect(names).toContain("cluster/roles.sql");
      expect(names).toContain("cluster/extensions/pgcrypto.sql");
      expect(names.some((n) => n.startsWith("_cluster/"))).toBe(false);

      // the nested tree is exactly the flat tree with the two roots rewritten
      const flat = exportSqlFiles(fb).map((f) => f.name);
      expect(
        names.map((n) =>
          n.startsWith("cluster/") ? `_${n}` : n.replace(/^schemas\//, ""),
        ),
      ).toEqual(flat);
    } finally {
      await src.drop();
    }
  }, 60_000);

  test("schemas named after a reserved root dir escape to %5F… under flat", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("exppath_reserved");
    try {
      await src.pool.query(`
        CREATE SCHEMA "_cluster";
        CREATE TABLE "_cluster".t (id integer PRIMARY KEY);
        -- _custom/ is the export tree's other reserved root directory
        -- (frontends/custom-dir.ts): never written into, never pruned.
        CREATE SCHEMA "_custom";
        CREATE TABLE "_custom".t (id integer PRIMARY KEY);
        -- an ordinary underscore-prefixed schema is NOT reserved
        CREATE SCHEMA "_foo";
        CREATE TABLE "_foo".t (id integer PRIMARY KEY);
      `);
      const fb = (await extract(src.pool)).factBase;
      const names = exportSqlFiles(fb).map((f) => f.name);

      // the reserved root segment belongs to the cluster files…
      expect(names).toContain("_cluster/roles.sql");
      // …so the same-named SCHEMA percent-encodes its leading underscore
      expect(names).toContain("%5Fcluster/schema.sql");
      expect(names).toContain("%5Fcluster/tables/t.sql");
      expect(names).not.toContain("_cluster/schema.sql");
      expect(names).not.toContain("_cluster/tables/t.sql");
      // same for the reserved `_custom/` hand-authored-SQL directory: writing
      // there is a hard error in the CLI, so the schema must not claim it
      expect(names).toContain("%5Fcustom/schema.sql");
      expect(names).toContain("%5Fcustom/tables/t.sql");
      expect(names.some((n) => n.startsWith("_custom/"))).toBe(false);
      // only the literal reserved names escape — `_foo` keeps its own spelling
      expect(names).toContain("_foo/schema.sql");
      expect(names).toContain("_foo/tables/t.sql");

      // nested has no reserved-name problem: the schemas/ wrapper separates it
      const nested = exportSqlFiles(fb, { pathStyle: "nested" }).map(
        (f) => f.name,
      );
      expect(nested).toContain("schemas/_cluster/schema.sql");
      expect(nested).toContain("schemas/_custom/schema.sql");
      expect(nested).toContain("schemas/_foo/schema.sql");
    } finally {
      await src.drop();
    }
  }, 60_000);

  test("pathStyle composes with the ordered layout (shorter flattened names)", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("exppath_ordered");
    try {
      await src.pool.query(SETUP);
      const fb = (await extract(src.pool)).factBase;
      const flat = exportSqlFiles(fb, { layout: "ordered" }).map((f) => f.name);
      const nested = exportSqlFiles(fb, {
        layout: "ordered",
        pathStyle: "nested",
      }).map((f) => f.name);

      expect(flat.some((n) => /^\d{4}_app_tables_t\.sql$/.test(n))).toBe(true);
      expect(
        nested.some((n) => /^\d{4}_schemas_app_tables_t\.sql$/.test(n)),
      ).toBe(true);
      expect(flat.some((n) => /^\d{4}__cluster_roles\.sql$/.test(n))).toBe(
        true,
      );
      // same file COUNT and ordering — only the flattened names differ
      expect(flat.length).toBe(nested.length);
    } finally {
      await src.drop();
    }
  }, 60_000);

  test("pathStyle composes with the grouped layout", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("exppath_grouped");
    try {
      await src.pool.query(`
        CREATE SCHEMA ext;
        CREATE TABLE ext.a (id integer PRIMARY KEY);
        CREATE TABLE ext.b (id integer PRIMARY KEY);
      `);
      const fb = (await extract(src.pool)).factBase;
      const opts = {
        layout: "grouped",
        grouping: { flatSchemas: ["ext"] },
      } as const;
      expect(exportSqlFiles(fb, opts).map((f) => f.name)).toContain(
        "ext/tables.sql",
      );
      expect(
        exportSqlFiles(fb, { ...opts, pathStyle: "nested" }).map((f) => f.name),
      ).toContain("schemas/ext/tables.sql");
    } finally {
      await src.drop();
    }
  }, 60_000);
});
