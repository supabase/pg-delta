/**
 * projectManagementScope: database scope drops role/membership facts (so a
 * shared/co-located shadow's ambient cluster roles never diff) but RETAINS the
 * `owner` edges pointing at them as dangling ASSUMED references, so ownership
 * still serializes as `ALTER … OWNER TO`. The edge whose target role name equals
 * the resolved `defaultOwner` is pruned (that role is the implicit/applier owner
 * → no `OWNER TO` noise). `cluster` scope is identity.
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
  test("database scope drops roles/memberships but RETAINS owner edges as dangling", () => {
    const out = projectManagementScope(buildFactBase(facts, edges), "database");
    const kinds = out.facts().map((f) => f.id.kind);
    expect(kinds.sort()).toEqual(["schema", "table"]);
    // the owner edge to the (removed) role SURVIVES as a dangling assumed
    // reference — ownership must still serialize as ALTER … OWNER TO.
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]!.kind).toBe("owner");
    // retained deliberately, so no dangling-edge warning is raised.
    expect(out.diagnostics.filter((d) => d.code === "dangling_edge")).toEqual(
      [],
    );
  });

  test("database scope prunes the owner edge whose target is the defaultOwner", () => {
    const out = projectManagementScope(
      buildFactBase(facts, edges),
      "database",
      {
        defaultOwner: "app_owner",
      },
    );
    // app_owner is the implicit owner → its owner edge is dropped (no OWNER TO).
    expect(out.edges).toHaveLength(0);
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
