/**
 * projectManagementScope: database scope drops role/membership facts and the
 * owner edges pointing at them (so a shared/co-located shadow's ambient cluster
 * roles never diff); cluster scope is identity.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import { encodeId } from "../core/stable-id.ts";
import { projectManagementScope } from "./view.ts";

const facts: Fact[] = [
  { id: { kind: "schema", name: "app" }, payload: {} },
  {
    id: { kind: "table", schema: "app", name: "t" },
    parent: { kind: "schema", name: "app" },
    payload: {},
  },
  { id: { kind: "role", name: "app_owner" }, payload: {} },
  { id: { kind: "role", name: "reader" }, payload: {} },
  {
    id: { kind: "membership", role: "app_owner", member: "reader" },
    payload: { admin: false },
  },
];
const edges: DependencyEdge[] = [
  {
    from: { kind: "table", schema: "app", name: "t" },
    to: { kind: "role", name: "app_owner" },
    kind: "owner",
  },
];

describe("projectManagementScope", () => {
  test("database scope drops roles, memberships, and owner edges", () => {
    const out = projectManagementScope(buildFactBase(facts, edges), "database");
    const kinds = out.facts().map((f) => f.id.kind);
    expect(kinds.sort()).toEqual(["schema", "table"]);
    expect(out.edges).toHaveLength(0); // owner edge to role pruned
    // no dangling-edge warnings (edges pruned, not orphaned)
    expect(out.diagnostics.filter((d) => d.code === "dangling_edge")).toEqual(
      [],
    );
  });

  test("cluster scope is identity (roles/ownership managed)", () => {
    const fb = buildFactBase(facts, edges);
    const out = projectManagementScope(fb, "cluster");
    expect(out).toBe(fb);
    expect(out.get({ kind: "role", name: "app_owner" })).toBeDefined();
  });

  test("keeps ACL facts (grantee is ambient, resolved via assumedRoles)", () => {
    const withAcl: Fact[] = [
      ...facts,
      {
        id: {
          kind: "acl",
          target: { kind: "table", schema: "app", name: "t" },
          grantee: "reader",
        },
        parent: { kind: "table", schema: "app", name: "t" },
        payload: { privileges: ["SELECT"], grantable: [] },
      },
    ];
    const out = projectManagementScope(
      buildFactBase(withAcl, edges),
      "database",
    );
    expect(out.facts().some((f) => encodeId(f.id).startsWith("acl:"))).toBe(
      true,
    );
  });
});
