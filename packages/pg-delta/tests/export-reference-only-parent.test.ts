/**
 * `schema export --profile supabase` must export a managed object kept under a
 * reference-only platform parent — the canonical case being a user trigger on
 * `auth.users`. `auth`/`auth.users` are filtered by the policy but kept
 * reference-only (assumed schema), so they are neither ours to recreate nor
 * present in the from-pristine export baseline. Before the fix, `exportSqlFiles`
 * planned from a baseline that lacked them, so the kept trigger's requirement on
 * `auth.users` was unsatisfiable (missing requirement) / the assumed table was
 * recreated. Seeding reference-only facts into the export baseline resolves both
 * (PR #307 review #3501088189).
 *
 * Docker required. Uses a plain container + the real supabasePolicy (no heavy
 * Supabase image needed): a user trigger whose function lives in `public` is
 * kept managed by the policy's user-trigger rule.
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

describe("export: managed child under a reference-only assumed parent", () => {
  test("a user trigger on auth.users exports without recreating auth.users", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("export_refonly_src");
    dbs.push(src);

    // auth is a Supabase system schema (filtered + assumed → reference-only).
    // The trigger's function lives in public, so the policy keeps the trigger as
    // a user-managed object on the reference-only auth.users.
    await src.pool.query(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE FUNCTION public.handle_new_user() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RETURN new; END; $$;
      CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    `);

    const { factBase } = await extract(src.pool);
    const view = resolveView(factBase, supabasePolicy);
    const flat = flattenPolicy(supabasePolicy);

    // RED before the fix: this throws "missing requirement" (the trigger's
    // parent auth.users is reference-only and absent from the pristine baseline),
    // or the assumed auth.users is recreated.
    const files = exportSqlFiles(view, {
      assumedSchemas: flat.assumedSchemas,
      assumedRoles: flat.assumedRoles,
    });
    const sql = files.map((f) => f.sql).join("\n");

    // the user trigger IS exported ...
    expect(sql).toContain("on_auth_user_created");
    // ... and the assumed platform table is NOT recreated.
    expect(sql).not.toMatch(/CREATE TABLE[^;]*users/i);
  }, 60_000);
});
