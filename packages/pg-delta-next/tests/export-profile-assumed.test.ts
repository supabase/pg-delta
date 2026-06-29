/**
 * Profile export must preserve the policy's `assumedSchemas`/`assumedRoles`
 * (review P1). `exportSqlFiles` re-plans the managed view from a pristine
 * baseline. With a profile, that view legitimately keeps actions that consume
 * assumed-but-filtered objects — e.g. `CREATE EXTENSION … SCHEMA extensions`
 * (the `extensions` schema is filtered out of the managed view) or a
 * `GRANT … TO anon`. Without forwarding the assumed sets, the export plan's
 * action-graph guard treats those as stranded requirements and throws
 * `missing requirement` — even though the DB-to-DB `plan --profile` path
 * (which receives `assumedSchemas`/`assumedRoles`) succeeds.
 *
 * Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { flattenPolicy, resolveView } from "../src/policy/policy.ts";
import { supabasePolicy } from "../src/policy/supabase.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("profile export preserves assumed schemas/roles", () => {
  test("relocatable extension into a filtered schema exports without 'missing requirement'", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("export_assumed_sch");
    dbs.push(db);

    // `extensions` is a Supabase-managed schema (filtered out of the managed
    // view); citext relocated into it consumes `schema:extensions`.
    await db.pool.query(`
      CREATE SCHEMA extensions;
      CREATE EXTENSION citext SCHEMA extensions;
    `);

    const state = await extract(db.pool);
    const view = resolveView(state.factBase, supabasePolicy);
    const flat = flattenPolicy(supabasePolicy);

    // RED before the fix: exportSqlFiles → plan(pristine, view) throws
    //   missing requirement: action "CREATE EXTENSION "citext" SCHEMA
    //   "extensions"" consumes schema:extensions …
    const files = exportSqlFiles(view, {
      assumedSchemas: flat.assumedSchemas,
      assumedRoles: flat.assumedRoles,
    });

    const allSql = files.map((f) => f.sql).join("\n");
    expect(allSql).toContain(`CREATE EXTENSION "citext" SCHEMA "extensions"`);
  }, 120_000);
});
