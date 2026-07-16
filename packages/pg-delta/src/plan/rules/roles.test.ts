/**
 * Regression for issue #333 item 1 (P1 destructive): `DROP OWNED BY` in the
 * role-drop rule is a sledgehammer — it silently destroys any object the
 * role owns OUTSIDE the managed/projected view (never extracted by the
 * engine). Managed grants, default ACLs, and owned objects are already
 * revoked/reassigned/dropped by their own plan actions before the role drop
 * runs, so a plain `DROP ROLE` is sufficient when everything is managed, and
 * fails loud (instead of silently destroying data) when it isn't.
 */
import { describe, expect, test } from "bun:test";
import type { Fact } from "../../core/fact.ts";
import { roleRules } from "./roles.ts";

const roleFact: Fact = {
  id: { kind: "role", name: "somerole" },
  payload: {
    superuser: false,
    inherit: true,
    createRole: false,
    createDb: false,
    login: false,
    replication: false,
    bypassRls: false,
    config: [],
  },
};

describe("role drop", () => {
  test("emits a plain DROP ROLE, never DROP OWNED BY", () => {
    const spec = roleRules.role!.drop!(roleFact);
    const sql = Array.isArray(spec) ? spec.map((s) => s.sql) : spec.sql;
    expect(sql).toBe(`DROP ROLE "somerole"`);
  });
});
