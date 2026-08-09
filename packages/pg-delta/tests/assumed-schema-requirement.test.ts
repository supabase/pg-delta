/**
 * The assumed-schema ambient exemption must not cover objects that DON'T exist
 * on the target (PR #307 review #3499413404). A managed object that references a
 * NEW object in an assumed schema (e.g. `auth.extra`) which is absent from the
 * target is kept reference-only on the desired side, so its creation is
 * suppressed; the requirement guard previously treated any id in an assumed
 * schema as ambient and let the dependent plan through, only to fail at apply
 * time against the missing relation. It must instead fail at PLAN time like any
 * other filtered-away requirement. An existing assumed-schema object
 * (`auth.users`-style, present on the target) stays satisfied via `source.has`.
 *
 * Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { supabasePolicy } from "../src/policy/supabase.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("assumed-schema requirement guard", () => {
  test("a managed dependent on a non-existent assumed-schema object fails at plan time", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("assumed_req_src");
    const desired = await cluster.createDb("assumed_req_dst");
    dbs.push(source, desired);

    // target has the assumed schema but NOT `auth.extra`.
    await source.pool.query(`CREATE SCHEMA auth`);
    // desired adds `auth.extra` (filtered to reference-only by the profile) and a
    // managed public view that depends on it.
    await desired.pool.query(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.extra (id integer);
      CREATE VIEW public.needs_extra AS SELECT id FROM auth.extra;
    `);

    const [sourceState, desiredState] = await Promise.all([
      extract(source.pool),
      extract(desired.pool),
    ]);

    // RED before the fix: this does NOT throw — the view plans through because
    // `auth.extra` is treated as ambient, and apply would later fail against the
    // missing relation.
    expect(() =>
      plan(sourceState.factBase, desiredState.factBase, {
        policy: supabasePolicy,
      }),
    ).toThrow(/missing requirement[\s\S]*auth.*extra/);
  }, 120_000);
});
