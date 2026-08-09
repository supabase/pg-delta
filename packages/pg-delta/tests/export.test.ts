/**
 * Export round-trip gate (stage 9 deliverable 6):
 * loadSqlFiles(exportSqlFiles(fb)) ≡ fb hash-identically, and the
 * "ordered" layout loads with zero deferred rounds (single pass).
 * Cluster-scoped files (roles) are the environment's in databaseScratch
 * mode — the shadow's cluster already has them; the schema files still
 * reference them (ownership, grants) and must resolve.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { sharedCluster } from "./containers.ts";

const SCHEMA_SQL = `
  CREATE SCHEMA app;
  CREATE SCHEMA zlib;
  CREATE TYPE app.level AS ENUM ('low', 'high');
  CREATE SEQUENCE app.id_seq START 5;
  CREATE TABLE app.users (
    id integer NOT NULL DEFAULT nextval('app.id_seq'),
    lvl app.level DEFAULT 'low',
    email text NOT NULL,
    PRIMARY KEY (id)
  );
  CREATE INDEX users_email_idx ON app.users (email);
  -- cross-schema reference: zlib sorts AFTER app, so the by-object layout
  -- needs a deferred round for this view; the ordered layout must not
  CREATE TABLE zlib.notes (user_id integer, body text);
  CREATE VIEW app.user_notes AS
    SELECT u.id, n.body FROM app.users u JOIN zlib.notes n ON n.user_id = u.id;
  COMMENT ON TABLE app.users IS 'exported';
  CREATE FUNCTION app.add(a integer, b integer) RETURNS integer
    LANGUAGE sql IMMUTABLE AS 'SELECT a + b';
`;

describe("stage 9: declarative export", () => {
  test("load(export(fb)) is hash-identical; ordered layout needs zero deferred rounds", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exp_src");
    const shadowA = await cluster.createDb("exp_shadow_a");
    const shadowB = await cluster.createDb("exp_shadow_b");
    try {
      await source.pool.query(SCHEMA_SQL);
      const fb = (await extract(source.pool)).factBase;

      const byObject = exportSqlFiles(fb).filter(
        (f) => !f.name.startsWith("cluster/roles"),
      );
      const ordered = exportSqlFiles(fb, { layout: "ordered" }).filter(
        (f) => !f.name.includes("cluster_roles"),
      );

      // human layout: fidelity is the contract (rounds may be > 1)
      const loadedA = await loadSqlFiles(byObject, shadowA.pool);
      expect(loadedA.factBase.rootHash).toBe(fb.rootHash);

      // ordered layout: fidelity AND single-pass convergence
      const loadedB = await loadSqlFiles(ordered, shadowB.pool);
      expect(loadedB.factBase.rootHash).toBe(fb.rootHash);
      expect(loadedB.rounds).toBe(1);
    } finally {
      await Promise.all([source.drop(), shadowA.drop(), shadowB.drop()]);
    }
  }, 120_000);

  test("by-object layout writes the familiar tree", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exp_tree");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer);
        CREATE VIEW app.v AS SELECT id FROM app.t;
        CREATE FUNCTION app.f() RETURNS integer LANGUAGE sql AS 'SELECT 1';
      `);
      const fb = (await extract(source.pool)).factBase;
      const names = exportSqlFiles(fb).map((f) => f.name);
      expect(names).toContain("cluster/roles.sql");
      expect(names).toContain("schemas/app/schema.sql");
      expect(names).toContain("schemas/app/tables/t.sql");
      expect(names).toContain("schemas/app/views/v.sql");
      expect(names).toContain("schemas/app/functions/f.sql");
    } finally {
      await source.drop();
    }
  }, 60_000);
});
