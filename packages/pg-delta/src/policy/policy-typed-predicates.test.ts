/**
 * Unit tests for typed policy predicates (hardening Item 3 / review #7):
 * `edgeTo` can filter by edge KIND (provenance: managedBy / memberOfExtension /
 * owner / depends), and `validatePolicy` rejects a typo'd `idField` instead of
 * silently never matching. No Docker / database required.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { factMatches, validatePolicy, type Policy } from "./policy.ts";

const ext: StableId = { kind: "extension", name: "pg_partman" };
const parent: StableId = { kind: "table", schema: "public", name: "events" };
const child: StableId = { kind: "table", schema: "public", name: "events_p1" };

function makeFact(id: StableId): Fact {
  return { id, payload: {} };
}

const edges: DependencyEdge[] = [
  { from: child, to: ext, kind: "managedBy" },
  { from: child, to: parent, kind: "depends" },
];
const fb = buildFactBase(
  [makeFact(ext), makeFact(parent), makeFact(child)],
  edges,
);
const childFact = fb.get(child) as Fact;

describe("edgeTo — filter by edge kind (review #7)", () => {
  test("matches the depends edge", () => {
    expect(
      factMatches({ edgeTo: { edgeKind: "depends" } }, childFact, fb),
    ).toBe(true);
  });

  test("matches a managedBy edge to an extension", () => {
    expect(
      factMatches(
        { edgeTo: { edgeKind: "managedBy", kind: "extension" } },
        childFact,
        fb,
      ),
    ).toBe(true);
  });

  test("does NOT match an edge kind that is absent (owner)", () => {
    // without edge-kind filtering this would wrongly match (any outgoing edge)
    expect(factMatches({ edgeTo: { edgeKind: "owner" } }, childFact, fb)).toBe(
      false,
    );
  });

  test("edgeKind + target kind together: managedBy to a table is absent", () => {
    expect(
      factMatches(
        { edgeTo: { edgeKind: "managedBy", kind: "table" } },
        childFact,
        fb,
      ),
    ).toBe(false);
  });
});

describe("validatePolicy — reject typo'd idField (review #7)", () => {
  test("a real id field is accepted", () => {
    const good: Policy = {
      id: "ok",
      filter: [
        {
          match: { idField: { field: "member", glob: "x" } },
          action: "exclude",
        },
      ],
    };
    expect(() => validatePolicy(good)).not.toThrow();
  });

  test("extensionIntent id fields (ext/intentKind/key) are accepted", () => {
    // a custom profile policy must be able to scope extension-intent facts
    // (e.g. exclude a specific pg_cron job) by the fields of its stable id.
    for (const field of ["ext", "intentKind", "key"]) {
      const p: Policy = {
        id: `intent-${field}`,
        filter: [
          { match: { idField: { field, glob: "x" } }, action: "exclude" },
        ],
      };
      expect(() => validatePolicy(p)).not.toThrow();
    }
  });

  test("a typo'd id field throws (would otherwise silently never match)", () => {
    const bad: Policy = {
      id: "typo",
      filter: [
        {
          match: { idField: { field: "membr", glob: "x" } },
          action: "exclude",
        },
      ],
    };
    expect(() => validatePolicy(bad)).toThrow(/membr/);
  });

  test("typo'd idField nested under all/not is still caught", () => {
    const bad: Policy = {
      id: "nested",
      filter: [
        {
          match: {
            all: [
              { kind: "table" },
              { not: { idField: { field: "tbl", glob: "x" } } },
            ],
          },
          action: "exclude",
        },
      ],
    };
    expect(() => validatePolicy(bad)).toThrow(/tbl/);
  });
});
