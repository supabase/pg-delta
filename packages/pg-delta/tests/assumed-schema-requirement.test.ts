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
 * The fail-fast must NOT cover PLATFORM-provisioned members of assumed schemas
 * (Sentry SUPABASE-API-8CX): a DB-webhook trigger depends on
 * `supabase_functions.http_request()`, which is owned by
 * `supabase_functions_admin` (an assumed system role) and provisioned by the
 * platform — a target that has never had webhooks enabled lacks it, yet the
 * plan must go through. Ownership by an assumed role other than the default
 * owner is the discriminator (user objects are owned by `postgres`/user roles).
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

  test("a DB-webhook trigger plans when the target lacks the platform's supabase_functions infra", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("webhook_req_src");
    const desired = await cluster.createDb("webhook_req_dst");
    dbs.push(source, desired);

    // The system role is cluster-global on the shared test cluster.
    await source.pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_functions_admin') THEN
          CREATE ROLE supabase_functions_admin;
        END IF;
      END $$;
    `);

    // target: the table exists, webhooks were never provisioned.
    await source.pool.query(`CREATE TABLE public.deliverable (id integer)`);
    // desired: the platform provisioned the webhooks infra (schema + function
    // owned by the system role, as the Supabase image ships it) and the user
    // added a DB-webhook trigger.
    await desired.pool.query(`
      CREATE TABLE public.deliverable (id integer);
      CREATE SCHEMA supabase_functions;
      CREATE FUNCTION supabase_functions.http_request() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      ALTER FUNCTION supabase_functions.http_request() OWNER TO supabase_functions_admin;
      CREATE TRIGGER "CRUD Deliverables sync out"
        AFTER INSERT OR UPDATE ON public.deliverable FOR EACH ROW
        EXECUTE FUNCTION supabase_functions.http_request('https://example.com/webhook', 'POST');
    `);

    const [sourceState, desiredState] = await Promise.all([
      extract(source.pool),
      extract(desired.pool),
    ]);

    // RED before the fix (Sentry SUPABASE-API-8CX): missing requirement —
    // "depends on function:supabase_functions.http_request() … (a filter may
    // be hiding its creation)". The system-role-owned platform function is
    // present at apply time by platform guarantee.
    const thePlan = plan(sourceState.factBase, desiredState.factBase, {
      policy: supabasePolicy,
    });
    expect(
      thePlan.actions.some((a) =>
        /CREATE TRIGGER "CRUD Deliverables sync out"/.test(a.sql),
      ),
    ).toBe(true);
    // the plan never tries to create the platform function itself
    expect(
      thePlan.actions.some((a) => /CREATE (OR REPLACE )?FUNCTION/i.test(a.sql)),
    ).toBe(false);
  }, 120_000);
});
