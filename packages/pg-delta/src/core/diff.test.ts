import { describe, expect, test } from "bun:test";
import { diff } from "./diff.ts";
import { buildFactBase, type DependencyEdge, type Fact } from "./fact.ts";
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
const role: StableId = { kind: "role", name: "r" };

function facts(overrides?: { colAType?: string; withColB?: boolean }): Fact[] {
  const out: Fact[] = [
    { id: schema, payload: {} },
    { id: role, payload: { login: true } },
    { id: table, parent: schema, payload: { persistence: "p" } },
    {
      id: colA,
      parent: table,
      payload: { type: overrides?.colAType ?? "integer", notNull: false },
    },
  ];
  if (overrides?.withColB !== false) {
    out.push({
      id: colB,
      parent: table,
      payload: { type: "text", notNull: true },
    });
  }
  return out;
}

describe("diff", () => {
  test("diff(A, A) is empty", () => {
    expect(
      diff(buildFactBase(facts(), []), buildFactBase(facts(), [])),
    ).toEqual([]);
  });

  test("changed attribute yields a set delta with from/to", () => {
    const a = buildFactBase(facts(), []);
    const b = buildFactBase(facts({ colAType: "bigint" }), []);
    const deltas = diff(a, b);
    expect(deltas).toEqual([
      { verb: "set", id: colA, attr: "type", from: "integer", to: "bigint" },
    ]);
  });

  test("a payload key starting with `_` is non-semantic metadata — no delta", () => {
    // version-dependent / extraction-only metadata (e.g. an ACL's owner default
    // privilege set) lives under a `_` key so it never produces a spurious delta
    // (which would otherwise throw `no rule for attribute …`) across snapshots
    // or PG versions.
    const a = buildFactBase(
      [
        {
          id: table,
          parent: schema,
          payload: { persistence: "p", _meta: [1] },
        },
        { id: schema, payload: {} },
      ],
      [],
    );
    const b = buildFactBase(
      [
        {
          id: table,
          parent: schema,
          payload: { persistence: "p", _meta: [2, 3] },
        },
        { id: schema, payload: {} },
      ],
      [],
    );
    expect(diff(a, b)).toEqual([]);
  });

  test("removed fact yields remove with the full fact", () => {
    const a = buildFactBase(facts(), []);
    const b = buildFactBase(facts({ withColB: false }), []);
    const deltas = diff(a, b);
    expect(deltas).toEqual([
      {
        verb: "remove",
        fact: {
          id: colB,
          parent: table,
          payload: { type: "text", notNull: true },
        },
      },
    ]);
  });

  test("a removed container emits removes for every fact in the subtree", () => {
    const a = buildFactBase(facts(), []);
    const b = buildFactBase(
      [
        { id: schema, payload: {} },
        { id: role, payload: { login: true } },
      ],
      [],
    );
    const deltas = diff(a, b);
    expect(deltas.map((d) => d.verb)).toEqual(["remove", "remove", "remove"]);
    expect(deltas.every((d) => d.verb === "remove")).toBe(true);
  });

  test("edge differences yield link/unlink", () => {
    const ownerEdge: DependencyEdge = { from: table, to: role, kind: "owner" };
    const a = buildFactBase(facts(), []);
    const b = buildFactBase(facts(), [ownerEdge]);
    expect(diff(a, b)).toEqual([{ verb: "link", edge: ownerEdge }]);
    expect(diff(b, a)).toEqual([{ verb: "unlink", edge: ownerEdge }]);
  });

  test("attribute added/dropped from a payload diffs as set with undefined side", () => {
    const a = buildFactBase([{ id: role, payload: { login: true } }], []);
    const b = buildFactBase(
      [{ id: role, payload: { login: true, replication: true } }],
      [],
    );
    expect(diff(a, b)).toEqual([
      { verb: "set", id: role, attr: "replication", from: undefined, to: true },
    ]);
  });

  test("output is deterministic and sorted", () => {
    const a = buildFactBase(facts(), []);
    const b = buildFactBase(
      [
        { id: schema, payload: {} },
        { id: role, payload: { login: false } },
        { id: table, parent: schema, payload: { persistence: "u" } },
        {
          id: colA,
          parent: table,
          payload: { type: "bigint", notNull: false },
        },
      ],
      [],
    );
    const d1 = diff(a, b);
    const d2 = diff(a, b);
    expect(d1).toEqual(d2);
    // sorted by encoded id: column:... < role:... < table:...
    expect(d1.map((d) => d.verb)).toEqual(["set", "remove", "set", "set"]);
  });

  test("mirror property: diff(B, A) reverses verbs", () => {
    const a = buildFactBase(facts(), []);
    const b = buildFactBase(facts({ withColB: false, colAType: "bigint" }), []);
    const forward = diff(a, b);
    const backward = diff(b, a);
    const flip = (v: "add" | "remove" | "set" | "link" | "unlink") =>
      v === "add"
        ? "remove"
        : v === "remove"
          ? "add"
          : v === "link"
            ? "unlink"
            : v === "unlink"
              ? "link"
              : v;
    expect(backward.map((d) => d.verb).sort()).toEqual(
      forward.map((d) => flip(d.verb)).sort(),
    );
  });
});
