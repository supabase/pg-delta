/**
 * Missing-requirement guard vs roles WITNESSED by the source view (Sentry
 * SUPABASE-API-8CX, pattern B).
 *
 * Under `scope: "database"` every `role` fact is projected out of both views
 * (roles are cluster-global), and plan() compensates only for roles referenced
 * via `owner` edges plus whatever the caller passes as `assumedRoles`. A role
 * referenced ONLY as an ACL grantee (or a default-privilege FOR-role/grantee, a
 * membership endpoint, a user-mapping role, an RLS policy TO-role) got neither,
 * so a teardown `REVOKE … ON … FROM <role>` consumed a role id that "neither
 * exists on the target nor is produced by this plan" and the action-graph
 * requirement guard threw — even though the source view IS the target's
 * extract, and PostgreSQL cannot record a grant for a role that does not exist
 * on that target.
 *
 * The witness must stay SOURCE-side only: a DESIRED-side grant to a role with
 * no source witness is still a stranded reference (the role may not exist on
 * the target at all) and must keep failing loudly at plan time.
 *
 * No Docker required — synthetic fact bases exercise the planner wiring.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const appSchema: StableId = { kind: "schema", name: "app" };
const table: StableId = { kind: "table", schema: "app", name: "t" };
const role: StableId = { kind: "role", name: "lambda_service_role" };

const f = (
  id: StableId,
  parent?: StableId,
  payload: Fact["payload"] = {},
): Fact => (parent ? { id, parent, payload } : { id, payload });

const aclTo = (grantee: string, privileges: string[]): Fact =>
  f({ kind: "acl", target: table, grantee }, table, {
    privileges,
    grantable: [],
  });

describe("plan() — source-witnessed role requirement (SUPABASE-API-8CX pattern B)", () => {
  test("a REVOKE from a grantee-only role plans under database scope", () => {
    // target (source side): the table plus a grant to a role that owns nothing —
    // the role fact itself is projected out by the database scope.
    const source = buildFactBase(
      [
        f(appSchema),
        f(table, appSchema, { persistence: "p" }),
        f(role),
        aclTo("lambda_service_role", ["SELECT"]),
      ],
      [],
    );
    // desired: the grant is gone → the plan must REVOKE it on the target.
    const desired = buildFactBase(
      [f(appSchema), f(table, appSchema, { persistence: "p" })],
      [],
    );

    // RED before the fix: missing requirement — the REVOKE consumes
    // role:lambda_service_role, which the scope projection removed from the
    // view and nothing witnesses. GREEN: the source-side grant IS the witness
    // that the role exists on the target, so the REVOKE plans.
    const thePlan = plan(source, desired, { scope: "database" });
    expect(
      thePlan.actions.some((a) =>
        /REVOKE ALL ON TABLE "app"\."t" FROM "lambda_service_role"/.test(a.sql),
      ),
    ).toBe(true);
  });

  test("a desired-side GRANT to a role the source side witnesses plans", () => {
    // the grant exists on the target and the desired state widens it: the
    // replace's REVOKE+GRANT both consume the role, witnessed by the
    // source-side acl fact.
    const source = buildFactBase(
      [
        f(appSchema),
        f(table, appSchema, { persistence: "p" }),
        f(role),
        aclTo("lambda_service_role", ["SELECT"]),
      ],
      [],
    );
    const desired = buildFactBase(
      [
        f(appSchema),
        f(table, appSchema, { persistence: "p" }),
        aclTo("lambda_service_role", ["SELECT", "UPDATE"]),
      ],
      [],
    );

    const thePlan = plan(source, desired, { scope: "database" });
    expect(
      thePlan.actions.some((a) =>
        /GRANT SELECT, UPDATE ON TABLE "app"\."t" TO "lambda_service_role"/.test(
          a.sql,
        ),
      ),
    ).toBe(true);
  });

  test("a default-privilege teardown's FOR-role and grantee are witnessed", () => {
    const adp: Fact = {
      id: {
        kind: "defaultPrivilege",
        role: "deployer",
        schema: "app",
        objtype: "r",
        grantee: "lambda_service_role",
      },
      payload: { privileges: ["SELECT"], grantable: [] },
    };
    const source = buildFactBase([f(appSchema), adp], []);
    const desired = buildFactBase([f(appSchema)], []);

    // RED before the fix: the ADP drop consumes role:deployer and
    // role:lambda_service_role, both projected out by the database scope.
    const thePlan = plan(source, desired, { scope: "database" });
    expect(
      thePlan.actions.some((a) =>
        /ALTER DEFAULT PRIVILEGES FOR ROLE "deployer"/.test(a.sql),
      ),
    ).toBe(true);
  });

  test("a desired-side GRANT to a role with NO source witness still fails loudly", () => {
    const source = buildFactBase(
      [f(appSchema), f(table, appSchema, { persistence: "p" })],
      [],
    );
    // nothing on the source side ever mentions `ghost` — the role may not
    // exist on the target at all, so the stranded-reference fail-fast stands.
    const desired = buildFactBase(
      [
        f(appSchema),
        f(table, appSchema, { persistence: "p" }),
        aclTo("ghost", ["SELECT"]),
      ],
      [],
    );

    expect(() => plan(source, desired, { scope: "database" })).toThrow(
      /missing requirement[\s\S]*role:ghost/,
    );
  });
});
