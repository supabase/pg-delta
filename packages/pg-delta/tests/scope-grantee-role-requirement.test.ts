/**
 * A database-scoped DB↔DB diff must plan a `REVOKE … FROM <role>` even when the
 * role is referenced ONLY as an ACL grantee (Sentry SUPABASE-API-8CX, pattern
 * B). The `database` scope projects every `role` fact out of both views, and
 * plan() compensated only for roles referenced via `owner` edges — so a
 * grantee-only role (it owns nothing, no caller-supplied `assumedRoles`)
 * stranded the action-graph requirement guard: "consumes role:…, which neither
 * exists on the target nor is produced by this plan". The source view is the
 * target's own extract, and PostgreSQL cannot record a grant for a nonexistent
 * role, so the grant itself witnesses that the role exists at apply time.
 *
 * Mirrors the production shape (the branch-diff service plans between two live
 * databases with `scope: "database"` and no assumed-role list). Docker
 * required; plain alpine.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
const roles: Array<{ cluster: TestDb["cluster"]; name: string }> = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
  await Promise.all(
    roles.map(({ cluster, name }) =>
      cluster.adminPool.query(`DROP ROLE IF EXISTS "${name}"`).catch(() => {}),
    ),
  );
});

describe("database-scope requirement guard: grantee-only role", () => {
  test("a grant torn down FROM a grantee-only role plans and applies", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("grantee_only_src");
    const desired = await cluster.createDb("grantee_only_dst");
    dbs.push(source, desired);
    // cluster-global on the shared test cluster — unique per run.
    const role = `lambda_service_role_${source.name}`;
    roles.push({ cluster, name: role });
    await cluster.adminPool.query(`CREATE ROLE "${role}"`);

    // target: the table plus a grant to the role; the role OWNS nothing, so no
    // owner edge ever names it. desired: the grant (and the role) are gone.
    await source.pool.query(`
      CREATE TABLE public.campaign_credit_usage (id integer);
      GRANT SELECT ON public.campaign_credit_usage TO "${role}";
    `);
    await desired.pool.query(
      `CREATE TABLE public.campaign_credit_usage (id integer)`,
    );

    const [sourceState, desiredState] = await Promise.all([
      extract(source.pool),
      extract(desired.pool),
    ]);

    // RED before the fix: plan() throws `missing requirement: action "REVOKE
    // ALL ON TABLE "public"."campaign_credit_usage" FROM "<role>"" consumes
    // role:<role>, which neither exists on the target nor is produced by this
    // plan`. GREEN: the source-side grant witnesses the role.
    const thePlan = plan(sourceState.factBase, desiredState.factBase, {
      scope: "database",
    });
    const revoke = thePlan.actions.find((a) =>
      new RegExp(
        `REVOKE ALL ON TABLE "public"\\."campaign_credit_usage" FROM "${role}"`,
      ).test(a.sql),
    );
    expect(revoke).toBeDefined();

    // the plan is appliable on the target: the role exists there, so the
    // REVOKE (and every other action) executes.
    for (const action of thePlan.actions) {
      await source.pool.query(action.sql);
    }
    const acl = await source.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'campaign_credit_usage'
          AND grantee = $1`,
      [role],
    );
    expect(acl.rows[0]?.n).toBe("0");
  }, 120_000);
});
