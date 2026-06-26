/**
 * `assumedSchemas` ambient exemption (mirror of `assumedRoles`).
 *
 * A relocatable extension installed INTO a Supabase-managed schema
 * (`CREATE EXTENSION citext SCHEMA extensions`) emits an action that
 * `consumes schema:extensions`. The Supabase policy filters `extensions`
 * (a `SUPABASE_SYSTEM_SCHEMAS` member) out of the managed view, so the schema
 * is absent from the source view even though it physically exists at apply
 * time. Without `assumedSchemas`, the action-graph missing-requirement guard
 * treats the `consumes schema:extensions` edge as a stranded reference and
 * throws — exactly the dbdev core-roundtrip blocker.
 *
 * Declaring `extensions` (via `SUPABASE_SYSTEM_SCHEMAS`) in
 * `supabasePolicy.assumedSchemas` exempts it from the guard like `pg_*`/PUBLIC
 * and the assumed roles, so the plan emits `CREATE EXTENSION … SCHEMA
 * extensions` and applies cleanly against a database where the schema already
 * exists.
 *
 * Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { supabasePolicy } from "../src/policy/supabase.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("assumedSchemas: relocatable extension into a managed schema (e2e)", () => {
  test("CREATE EXTENSION citext SCHEMA extensions plans + applies under supabasePolicy", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("assumed_sch_src");
    const desired = await cluster.createDb("assumed_sch_dst");
    dbs.push(source, desired);

    // `extensions` exists on BOTH databases (a platform-managed schema present
    // at apply time), but the policy projects it out of the managed view.
    await source.pool.query(`CREATE SCHEMA extensions`);
    await desired.pool.query(`
      CREATE SCHEMA extensions;
      CREATE EXTENSION citext SCHEMA extensions;
    `);

    const [sourceState, desiredState] = await Promise.all([
      extract(source.pool),
      extract(desired.pool),
    ]);

    // RED before the fix: this throws
    //   missing requirement: action "CREATE EXTENSION "citext" SCHEMA
    //   "extensions"" consumes schema:extensions, which neither exists on the
    //   target nor is produced by this plan
    const policyPlan = plan(sourceState.factBase, desiredState.factBase, {
      policy: supabasePolicy,
    });

    // the relocatable extension renders WITH its SCHEMA clause
    const createsCitext = policyPlan.actions.some((a) =>
      a.sql.includes(`CREATE EXTENSION "citext" SCHEMA "extensions"`),
    );
    expect(createsCitext).toBe(true);

    // applies cleanly against `source` (which already has the extensions schema)
    const report = await apply(policyPlan, source.pool, {
      fingerprintGate: false,
    });
    expect(report.status).toBe("applied");

    // re-diffing under the policy now converges to zero actions
    const reSource = await extract(source.pool);
    const rePlan = plan(reSource.factBase, desiredState.factBase, {
      policy: supabasePolicy,
    });
    expect(rePlan.actions).toEqual([]);
  }, 120_000);
});
