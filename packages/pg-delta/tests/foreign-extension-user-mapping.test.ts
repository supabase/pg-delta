/**
 * Item 15 (issue #333): a user mapping whose SERVER was added to an extension
 * (`ALTER EXTENSION … ADD SERVER …`) orphans `buildFactBase` — the server
 * itself is correctly excluded as an extension member (foreign.ts's
 * `notExtensionMember("pg_foreign_server", "s.oid")` on the server query), but
 * the user-mapping query has no matching anti-join, so it still emits a
 * `userMapping` fact parented to a server id that was never extracted. This is
 * a superuser-only scenario (extension ownership, not a role-privilege gap).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("item 15: user mapping on an extension-owned server", () => {
  test("extract() succeeds and omits the orphaned mapping (no missing-parent throw)", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("ext_server_mapping");
    dbs.push(db);
    await db.pool.query(`
      CREATE EXTENSION citext;
      CREATE FOREIGN DATA WRAPPER dummy_fdw;
      CREATE SERVER s1 FOREIGN DATA WRAPPER dummy_fdw;
      ALTER EXTENSION citext ADD SERVER s1;
      CREATE USER MAPPING FOR CURRENT_USER SERVER s1;
    `);

    // GREEN: resolves, and the mapping (parented to the extension-excluded
    // server) is absent from the fact base. RED (missing anti-join): rejects
    // with `FactBase: fact userMapping:… references missing parent server:s1`.
    const { factBase } = await extract(db.pool);
    expect(factBase.facts().some((f) => f.id.kind === "userMapping")).toBe(
      false,
    );
    expect(factBase.facts().some((f) => f.id.kind === "server")).toBe(false);
  }, 60_000);
});
