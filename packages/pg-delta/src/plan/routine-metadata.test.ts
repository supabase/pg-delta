/**
 * Routine metadata/ACL rendering must respect function vs procedure
 * (REVIEW_HANDOFF.md P0). PostgreSQL rejects the FUNCTION form for a real
 * procedure: `COMMENT ON FUNCTION public.p()` and `GRANT ... ON FUNCTION
 * public.p()` both error with "public.p() is not a function". The comment /
 * ACL / security-label renderers address a routine purely by its stable id,
 * so the id must carry the function-vs-procedure distinction.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: { owner: "test" },
};
const roleFact: Fact = {
  id: { kind: "role", name: "r" },
  payload: {},
};

const procId: StableId = {
  kind: "procedure",
  schema: "app",
  name: "p",
  args: [],
};
const procFact: Fact = {
  id: procId,
  parent: { kind: "schema", name: "app" },
  payload: {
    def: `CREATE PROCEDURE "app"."p"() LANGUAGE sql AS $$ SELECT 1 $$`,
  },
};
const procComment: Fact = {
  id: { kind: "comment", target: procId },
  parent: procId,
  payload: { text: "does things" },
};
const procAcl: Fact = {
  id: { kind: "acl", target: procId, grantee: "r" },
  parent: procId,
  payload: { privileges: ["EXECUTE"], grantable: [] },
};

// the schema + grantee role pre-exist on both sides; only the routine and its
// satellites are added, so the plan is the metadata DDL under test.
const base = (extra: Fact[]) =>
  buildFactBase([schemaFact, roleFact, ...extra], []);

describe("routine metadata/ACL rendering (function vs procedure)", () => {
  test("COMMENT on a procedure uses PROCEDURE, not FUNCTION", () => {
    const actions = plan(base([]), base([procFact, procComment])).actions;
    const sql = actions.map((a) => a.sql);
    expect(sql).toContain(`COMMENT ON PROCEDURE "app"."p"() IS 'does things'`);
    expect(sql.some((s) => s.includes(`COMMENT ON FUNCTION "app"."p"()`))).toBe(
      false,
    );
  });

  test("GRANT EXECUTE on a procedure uses PROCEDURE, not FUNCTION", () => {
    // compact: false to keep the decomposed REVOKE+GRANT pair — the co-create
    // REVOKE elision (elideCoCreateRevokeBeforeGrant) would otherwise drop the
    // leading REVOKE, and this test asserts the keyword on BOTH statements.
    const actions = plan(base([]), base([procFact, procAcl]), {
      compact: false,
    }).actions;
    const sql = actions.map((a) => a.sql);
    expect(sql).toContain(`GRANT EXECUTE ON PROCEDURE "app"."p"() TO "r"`);
    expect(sql).toContain(`REVOKE ALL ON PROCEDURE "app"."p"() FROM "r"`);
    expect(sql.some((s) => s.includes(`ON FUNCTION "app"."p"()`))).toBe(false);
  });

  // regression guard: a real function must still render the FUNCTION keyword.
  test("COMMENT/GRANT on a function still use FUNCTION", () => {
    const fnId: StableId = {
      kind: "function",
      schema: "app",
      name: "f",
      args: [],
    };
    const fnFact: Fact = {
      id: fnId,
      parent: { kind: "schema", name: "app" },
      payload: {
        def: `CREATE FUNCTION "app"."f"() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$`,
      },
    };
    const fnComment: Fact = {
      id: { kind: "comment", target: fnId },
      parent: fnId,
      payload: { text: "computes" },
    };
    const fnAcl: Fact = {
      id: { kind: "acl", target: fnId, grantee: "r" },
      parent: fnId,
      payload: { privileges: ["EXECUTE"], grantable: [] },
    };
    const sql = plan(base([]), base([fnFact, fnComment, fnAcl])).actions.map(
      (a) => a.sql,
    );
    expect(sql).toContain(`COMMENT ON FUNCTION "app"."f"() IS 'computes'`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION "app"."f"() TO "r"`);
    expect(sql.some((s) => s.includes(`ON PROCEDURE "app"."f"()`))).toBe(false);
  });
});
