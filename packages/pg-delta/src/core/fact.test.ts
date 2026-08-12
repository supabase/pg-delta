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

// ---------------------------------------------------------------------------
// The lookup layer memoizes id encodings, but ONLY for ids the engine itself
// registered while building a FactBase. A CALLER's query object must never enter
// that cache: `fb.get(q)` is public, so a caller may reuse and mutate `q` between
// lookups and must get an answer for the value `q` currently holds.
//
// (Mutating a fact's OWN id object — one obtained from `fb.facts()` — remains
// undefined behavior: it desynchronizes the string-keyed indexes with or without
// any memo. That is the pre-existing contract and is not what these pin.)
// ---------------------------------------------------------------------------

describe("FactBase lookups do not cache caller query objects", () => {
  const alpha: StableId = { kind: "schema", name: "alpha" };
  const beta: StableId = { kind: "schema", name: "beta" };
  const tAlpha: StableId = { kind: "table", schema: "alpha", name: "t" };
  const tBeta: StableId = { kind: "table", schema: "beta", name: "t" };

  function twoSchemas() {
    return buildFactBase(
      [
        { id: alpha, payload: {} },
        { id: beta, payload: {} },
        { id: tAlpha, parent: alpha, payload: {} },
        { id: tBeta, parent: beta, payload: {} },
      ],
      [
        { from: tAlpha, to: alpha, kind: "owner" },
        { from: tBeta, to: beta, kind: "owner" },
      ],
    );
  }

  test("get() re-reads a mutated query object", () => {
    const fb = twoSchemas();
    const q: StableId = { kind: "schema", name: "alpha" };
    expect(fb.get(q)?.id).toEqual(alpha);
    (q as { name: string }).name = "beta";
    expect(fb.get(q)?.id).toEqual(beta);
  });

  test("get() reports absence after a query object is mutated to a missing id", () => {
    const fb = twoSchemas();
    const q: StableId = { kind: "schema", name: "alpha" };
    expect(fb.get(q)).toBeDefined();
    (q as { name: string }).name = "gamma";
    expect(fb.get(q)).toBeUndefined();
  });

  test("has() re-reads a mutated query object", () => {
    const fb = twoSchemas();
    const q: StableId = { kind: "schema", name: "alpha" };
    expect(fb.has(q)).toBe(true);
    (q as { name: string }).name = "gamma";
    expect(fb.has(q)).toBe(false);
  });

  test("childrenOf() re-reads a mutated query object", () => {
    const fb = twoSchemas();
    const q: StableId = { kind: "schema", name: "alpha" };
    expect(fb.childrenOf(q).map((f) => f.id)).toEqual([tAlpha]);
    (q as { name: string }).name = "beta";
    expect(fb.childrenOf(q).map((f) => f.id)).toEqual([tBeta]);
  });

  test("outgoingEdges() re-reads a mutated query object", () => {
    const fb = twoSchemas();
    const q: StableId = { kind: "table", schema: "alpha", name: "t" };
    expect(fb.outgoingEdges(q).map((e) => e.to)).toEqual([alpha]);
    (q as { schema: string }).schema = "beta";
    expect(fb.outgoingEdges(q).map((e) => e.to)).toEqual([beta]);
  });

  test("incomingEdges() re-reads a mutated query object", () => {
    const fb = twoSchemas();
    const q: StableId = { kind: "schema", name: "alpha" };
    expect(fb.incomingEdges(q).map((e) => e.from)).toEqual([tAlpha]);
    (q as { name: string }).name = "beta";
    expect(fb.incomingEdges(q).map((e) => e.from)).toEqual([tBeta]);
  });

  test("hashOf()/rollupOf() re-read a mutated query object", () => {
    const fb = twoSchemas();
    const q: StableId = { kind: "table", schema: "alpha", name: "t" };
    const alphaRollup = fb.rollupOf(q);
    (q as { schema: string }).schema = "beta";
    expect(fb.rollupOf(q)).toBe(fb.rollupOf(tBeta));
    expect(fb.rollupOf(q)).not.toBe(alphaRollup);
    expect(fb.hashOf(q)).toBe(fb.hashOf(tBeta));
  });

  // Correctness of the registration memo itself: ids registered while building
  // ONE FactBase must still resolve in ANOTHER (diff's hot pattern is
  // `b.get(factFromA.id)`), because the memo is module-global.
  test("an id object registered by one FactBase resolves in another", () => {
    const a = twoSchemas();
    const b = twoSchemas();
    for (const fact of a.facts()) {
      expect(b.get(fact.id)?.id).toEqual(fact.id);
      expect(b.has(fact.id)).toBe(true);
      expect(b.hashOf(fact.id)).toBe(a.hashOf(fact.id));
    }
    // and a FactBase that does NOT contain the id still answers honestly
    const onlyAlpha = buildFactBase([{ id: alpha, payload: {} }], []);
    expect(onlyAlpha.get(beta)).toBeUndefined();
    expect(onlyAlpha.get(alpha)?.id).toEqual(alpha);
  });
});
