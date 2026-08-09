import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact, type DependencyEdge } from "./fact.ts";
import type { StableId } from "./stable-id.ts";

const schema: StableId = { kind: "schema", name: "public" };
const table: StableId = { kind: "table", schema: "public", name: "users" };
const colA: StableId = {
  kind: "column",
  schema: "public",
  table: "users",
  name: "a",
};
const colB: StableId = {
  kind: "column",
  schema: "public",
  table: "users",
  name: "b",
};
const role: StableId = { kind: "role", name: "owner1" };

function baseFacts(): Fact[] {
  return [
    { id: schema, payload: {} },
    { id: role, payload: { login: false } },
    { id: table, parent: schema, payload: { persistence: "p" } },
    { id: colA, parent: table, payload: { type: "integer", notNull: false } },
    { id: colB, parent: table, payload: { type: "text", notNull: true } },
  ];
}

describe("buildFactBase", () => {
  test("insertion order does not affect any hash", () => {
    const facts = baseFacts();
    const fb1 = buildFactBase(facts, []);
    const fb2 = buildFactBase([...facts].reverse(), []);
    expect(fb1.rootHash).toBe(fb2.rootHash);
    expect(fb1.rollupOf(table)).toBe(fb2.rollupOf(table));
  });

  test("a leaf payload change propagates to ancestors but not siblings", () => {
    const fb1 = buildFactBase(baseFacts(), []);
    const changed = baseFacts().map((f) =>
      f.id === colA ? { ...f, payload: { type: "bigint", notNull: false } } : f,
    );
    const fb2 = buildFactBase(changed, []);
    expect(fb2.hashOf(colA)).not.toBe(fb1.hashOf(colA));
    expect(fb2.rollupOf(table)).not.toBe(fb1.rollupOf(table));
    expect(fb2.rollupOf(schema)).not.toBe(fb1.rollupOf(schema));
    expect(fb2.rootHash).not.toBe(fb1.rootHash);
    // sibling untouched
    expect(fb2.hashOf(colB)).toBe(fb1.hashOf(colB));
    expect(fb2.rollupOf(colB)).toBe(fb1.rollupOf(colB));
    // unrelated root untouched
    expect(fb2.rollupOf(role)).toBe(fb1.rollupOf(role));
  });

  test("renaming a child changes parent rollup but not parent structural rollup", () => {
    const fb1 = buildFactBase(baseFacts(), []);
    const renamed: StableId = {
      kind: "column",
      schema: "public",
      table: "users",
      name: "a2",
    };
    const facts = baseFacts().map((f) =>
      f.id === colA ? { ...f, id: renamed } : f,
    );
    const fb2 = buildFactBase(facts, []);
    expect(fb2.rollupOf(table)).not.toBe(fb1.rollupOf(table));
    expect(fb2.structuralRollupOf(table)).toBe(fb1.structuralRollupOf(table));
  });

  test("an edge change is visible in the rollup of its source fact", () => {
    const e1: DependencyEdge[] = [{ from: table, to: role, kind: "owner" }];
    const fb1 = buildFactBase(baseFacts(), e1);
    const fb0 = buildFactBase(baseFacts(), []);
    expect(fb1.rollupOf(table)).not.toBe(fb0.rollupOf(table));
    expect(fb1.rootHash).not.toBe(fb0.rootHash);
    // the edge target's own rollup is unaffected (edges are outgoing-folded)
    expect(fb1.rollupOf(role)).toBe(fb0.rollupOf(role));
  });

  test("renaming a root changes the root hash", () => {
    const fb1 = buildFactBase(baseFacts(), []);
    const renamedRole: StableId = { kind: "role", name: "owner2" };
    const facts = baseFacts().map((f) =>
      f.id === role ? { ...f, id: renamedRole } : f,
    );
    const fb2 = buildFactBase(facts, []);
    expect(fb2.rootHash).not.toBe(fb1.rootHash);
  });

  test("duplicate ids throw", () => {
    expect(() =>
      buildFactBase(
        [...baseFacts(), { id: colA, parent: table, payload: {} }],
        [],
      ),
    ).toThrow(/duplicate/i);
  });

  test("a parent reference to a missing fact throws", () => {
    const orphan: Fact = {
      id: { kind: "column", schema: "x", table: "missing", name: "c" },
      parent: { kind: "table", schema: "x", name: "missing" },
      payload: {},
    };
    expect(() => buildFactBase([...baseFacts(), orphan], [])).toThrow(
      /parent/i,
    );
  });

  test("a self-parent fact is rejected (its cycle has no root)", () => {
    // Every parent exists (it is itself), so the missing-parent check passes,
    // but the fact never reaches a parentless root: roots() omits it and
    // rootHash silently fingerprints like a base that does not contain it.
    const self: StableId = { kind: "schema", name: "loop" };
    expect(() =>
      buildFactBase([{ id: self, parent: self, payload: {} }], []),
    ).toThrow(/cycle/i);
  });

  test("a parent cycle among facts is rejected and names the members", () => {
    const a: StableId = { kind: "schema", name: "a" };
    const b: StableId = { kind: "schema", name: "b" };
    expect(() =>
      buildFactBase(
        [
          { id: a, parent: b, payload: {} },
          { id: b, parent: a, payload: {} },
        ],
        [],
      ),
    ).toThrow(/cycle/i);
  });

  test("dangling edges are dropped with a diagnostic, not thrown", () => {
    const dangling: DependencyEdge[] = [
      {
        from: table,
        to: { kind: "table", schema: "x", name: "ghost" },
        kind: "depends",
      },
    ];
    const fb = buildFactBase(baseFacts(), dangling);
    expect(fb.diagnostics).toHaveLength(1);
    expect(fb.diagnostics[0]?.code).toBe("dangling_edge");
    expect([...fb.edges]).toHaveLength(0);
  });

  test("children are listed and facts retrievable", () => {
    const fb = buildFactBase(baseFacts(), []);
    expect(fb.childrenOf(table).map((f) => f.id)).toEqual([colA, colB]);
    expect(fb.get(colA)?.payload).toEqual({ type: "integer", notNull: false });
    expect(fb.get({ kind: "table", schema: "no", name: "pe" })).toBeUndefined();
  });
});
