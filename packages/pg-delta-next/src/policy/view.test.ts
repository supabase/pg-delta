/**
 * The single fact-level projection primitive (docs/architecture/managed-view-architecture.md
 * move 4): `excludeByProvenance(fb, edgeKind)` removes every fact carrying an
 * outgoing edge of that kind plus its descendant subtree, and prunes edges with
 * a removed endpoint. `resolveView` uses it directly for `managedBy`; future
 * scope/capability projections reuse the same core.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { excludeByProvenance } from "./view.ts";

const schema = (name: string): StableId => ({ kind: "schema", name });
const table = (s: string, name: string): StableId => ({
  kind: "table",
  schema: s,
  name,
});
const ext: StableId = { kind: "extension", name: "pgmq" };
const f = (id: StableId, parent?: StableId): Fact =>
  parent ? { id, parent, payload: {} } : { id, payload: {} };

describe("excludeByProvenance — generic fact-level projection", () => {
  test("removes a tagged root, its descendant subtree, and prunes dangling edges", () => {
    const pub = schema("public");
    const memberTable = table("public", "q_jobs");
    const memberCol: StableId = {
      kind: "column",
      schema: "public",
      table: "q_jobs",
      name: "id",
    };
    const userTable = table("public", "app");

    const fb = buildFactBase(
      [
        f(pub),
        f(ext, pub),
        f(memberTable, pub),
        f(memberCol, memberTable),
        f(userTable, pub),
      ],
      [
        { from: memberTable, to: ext, kind: "memberOfExtension" },
        // a dangling-after-removal edge: user table depends on the member
        { from: userTable, to: memberTable, kind: "depends" },
      ],
    );

    const out = excludeByProvenance(fb, "memberOfExtension");

    // member root + its column descendant are gone; user + public + ext stay
    expect(out.get(memberTable)).toBeUndefined();
    expect(out.get(memberCol)).toBeUndefined();
    expect(out.get(userTable)).toBeDefined();
    expect(out.get(pub)).toBeDefined();
    // the depends edge into the removed member is pruned
    expect(out.edges.some((e) => e.kind === "depends")).toBe(false);
  });

  test("returns the same instance when no fact carries the edge (early-exit)", () => {
    const fb = buildFactBase([f(schema("public"))], []);
    expect(excludeByProvenance(fb, "managedBy")).toBe(fb);
  });

  test("only the named edge kind selects roots", () => {
    const pub = schema("public");
    const managed = table("public", "child");
    const fb = buildFactBase(
      [f(pub), f(managed, pub)],
      [{ from: managed, to: pub, kind: "managedBy" }],
    );
    // projecting by memberOfExtension leaves the managedBy-tagged fact in place
    expect(
      excludeByProvenance(fb, "memberOfExtension").get(managed),
    ).toBeDefined();
    // projecting by managedBy removes it
    expect(excludeByProvenance(fb, "managedBy").get(managed)).toBeUndefined();
  });
});
