/**
 * `schema export` must not crash when an extension is installed into a
 * non-`public` schema (e.g. pg_partman → `partman`, or hstore → `ext` here).
 *
 * The extension's member objects (the `hstore` type, its functions/operators)
 * are marked REFERENCE-ONLY by `resolveView` on every profile, but their parent
 * — the install schema — is a normal MANAGED fact. The export baseline seeded
 * every reference-only fact without its ancestors, so `buildFactBase(pristine)`
 * found a member with a missing parent schema and threw before writing any file
 * (Codex #3537607461):
 *
 *   FactBase: fact type:ext.hstore references missing parent schema:ext
 *
 * The fix excludes extension members from the pristine baseline (they never need
 * seeding — `CREATE EXTENSION` materializes them and the requirement guard's
 * `memberExtensionPresent` satisfies any consumer). The managed install schema
 * must STILL be exported (reload fidelity: `CREATE EXTENSION … WITH SCHEMA ext`
 * requires the schema to exist first).
 *
 * Docker required. Stock alpine — hstore is a relocatable contrib extension that
 * ships in the base `postgres:*-alpine` image (see extension-relocatable.test.ts).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { resolveView } from "../src/policy/policy.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("export: extension member under a managed (non-public) schema", () => {
  test("exports the managed install schema + CREATE EXTENSION, not the members", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("export_ext_member");
    dbs.push(src);

    await src.pool.query(`
      CREATE SCHEMA ext;
      CREATE EXTENSION hstore WITH SCHEMA ext;
    `);

    const { factBase } = await extract(src.pool);
    // raw profile: extension members are still projected reference-only, and
    // their parent `ext` schema is managed → the missing-parent crash.
    const view = resolveView(factBase, undefined);

    // RED before the fix: throws
    //   "FactBase: fact type:ext.hstore references missing parent schema:ext"
    const files = exportSqlFiles(view);
    const sql = files.map((f) => f.sql).join("\n");

    // the MANAGED install schema is exported (not suppressed) ...
    expect(sql).toMatch(/CREATE SCHEMA[^\n]*ext/i);
    // ... the extension is created into it ...
    expect(sql).toMatch(/CREATE EXTENSION[^\n]*hstore/i);
    // ... and its members are NOT recreated as standalone DDL.
    expect(sql).not.toMatch(/CREATE TYPE/i);
  }, 60_000);

  test("a user comment on an extension member still exports", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("export_ext_member_satellite");
    dbs.push(src);

    await src.pool.query(`
      CREATE SCHEMA ext;
      CREATE EXTENSION hstore WITH SCHEMA ext;
      -- comment on a MEMBER FUNCTION (a modeled member; the hstore type itself
      -- is an unmodeled base type, so it carries no fact to comment on).
      COMMENT ON FUNCTION ext.akeys(ext.hstore) IS 'user note on an extension member';
    `);

    const { factBase } = await extract(src.pool);
    const view = resolveView(factBase, undefined);

    const files = exportSqlFiles(view);
    const sql = files.map((f) => f.sql).join("\n");

    // the member satellite (a user COMMENT on an extension member function)
    // exports; its requirement on the reference-only member is satisfied by the
    // CREATE EXTENSION the export emits (memberExtensionPresent).
    expect(sql).toMatch(/COMMENT ON FUNCTION[^\n]*akeys[^\n]*user note/i);
  }, 60_000);
});
