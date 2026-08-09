/**
 * Unit tests for compaction's redundant-drop elision (fourth follow-up review
 * discussion). No Docker / database required.
 *
 * `acl` replace is rendered as drop + create, but `grantActions` (the create)
 * already leads with its own `REVOKE ALL … FROM grantee` reset — so the drop's
 * `REVOKE ALL … FROM grantee` is a byte-identical, redundant statement. This is
 * a GENERAL property of every ACL privilege change (no rename needed), so the
 * elision lives in the cosmetic compaction pass (correctness first, prettify
 * later) rather than being special-cased per kind in the planner.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaApp: StableId = { kind: "schema", name: "app" };
const tableT: StableId = { kind: "table", schema: "app", name: "t" };
const roleR: StableId = { kind: "role", name: "r" };
const aclR: StableId = { kind: "acl", target: tableT, grantee: "r" };

const f = (id: StableId, payload: Payload = {}, parent?: StableId): Fact =>
  parent ? { id, parent, payload } : { id, payload };
const tablePayload = (): Payload => ({
  persistence: "p",
  rowSecurity: false,
  forceRowSecurity: false,
  replicaIdentity: "d",
  replicaIdentityIndex: null,
  partitionKey: null,
  partitionBound: null,
  parentTable: null,
});

describe("compaction elides the redundant ACL-replace REVOKE", () => {
  const acl = (privs: string[]): Fact =>
    f(aclR, { privileges: privs, grantable: [] }, tableT);
  const source = buildFactBase(
    [
      f(schemaApp),
      f(roleR),
      f(tableT, tablePayload(), schemaApp),
      acl(["SELECT"]),
    ],
    [],
  );
  const desired = buildFactBase(
    [
      f(schemaApp),
      f(roleR),
      f(tableT, tablePayload(), schemaApp),
      acl(["SELECT", "INSERT"]),
    ],
    [],
  );

  test("an ACL privilege change emits exactly one REVOKE (no rename)", () => {
    const p = plan(source, desired);
    const revokes = p.actions.filter((a) =>
      a.sql.includes('REVOKE ALL ON TABLE "app"."t" FROM "r"'),
    );
    expect(revokes).toHaveLength(1);
    // the GRANT of the new privileges still follows
    expect(
      p.actions.some(
        (a) => a.sql.includes("GRANT") && a.sql.includes('TO "r"'),
      ),
    ).toBe(true);
  });

  test("with compaction off, the redundant REVOKE is preserved (correctness-first)", () => {
    const p = plan(source, desired, { compact: false });
    const revokes = p.actions.filter((a) =>
      a.sql.includes('REVOKE ALL ON TABLE "app"."t" FROM "r"'),
    );
    // uncompacted plan keeps the drop's REVOKE + the create's reset REVOKE
    expect(revokes).toHaveLength(2);
  });
});
