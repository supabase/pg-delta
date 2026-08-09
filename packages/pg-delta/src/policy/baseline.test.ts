/**
 * Unit tests for baseline subtraction (src/policy/baseline.ts).
 * No Docker / database required.
 */

import { describe, expect, test } from "bun:test";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { plan } from "../plan/plan.ts";
import { subtractBaseline } from "./baseline.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const schemaPublic: StableId = { kind: "schema", name: "public" };
const schemaPrivate: StableId = { kind: "schema", name: "private" };
const tableUsers: StableId = { kind: "table", schema: "public", name: "users" };
const tableAdmins: StableId = {
  kind: "table",
  schema: "public",
  name: "admins",
};
const colId: StableId = {
  kind: "column",
  schema: "public",
  table: "users",
  name: "id",
};
const _colEmail: StableId = {
  kind: "column",
  schema: "public",
  table: "users",
  name: "email",
};
const roleOwner: StableId = { kind: "role", name: "owner" };
const extPostgis: StableId = { kind: "extension", name: "postgis" };

function makeFact(
  id: StableId,
  payload: Payload = {},
  parent?: StableId,
): Fact {
  return parent ? { id, parent, payload } : { id, payload };
}

// ---------------------------------------------------------------------------
// describe: identity subtraction
// ---------------------------------------------------------------------------

describe("subtractBaseline — identity subtraction", () => {
  test("subtracting identical baseline leaves empty FactBase", () => {
    const facts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic),
      makeFact(colId, { type: "integer" }, tableUsers),
    ];
    const fb = buildFactBase(facts, []);
    const baseline = buildFactBase(facts, []);
    const result = subtractBaseline(fb, baseline);
    expect(result.facts()).toHaveLength(0);
  });

  test("subtracting empty baseline changes nothing", () => {
    const facts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic),
    ];
    const fb = buildFactBase(facts, []);
    const baseline = buildFactBase([], []);
    const result = subtractBaseline(fb, baseline);
    expect(result.facts()).toHaveLength(2);
  });

  test("fact not present in baseline is kept", () => {
    const baselineFacts: Fact[] = [makeFact(schemaPublic)];
    const fullFacts: Fact[] = [
      ...baselineFacts,
      makeFact(tableUsers, {}, schemaPublic),
    ];
    const fb = buildFactBase(fullFacts, []);
    const baseline = buildFactBase(baselineFacts, []);
    const result = subtractBaseline(fb, baseline);
    // tableUsers survives (not in baseline)
    // schemaPublic is subtracted (identical in baseline)
    // BUT schemaPublic is the parent of tableUsers → force-kept
    expect(result.has(tableUsers)).toBe(true);
    expect(result.has(schemaPublic)).toBe(true); // kept as ancestor
  });
});

// ---------------------------------------------------------------------------
// describe: changed-payload subtraction
// ---------------------------------------------------------------------------

describe("subtractBaseline — changed payload", () => {
  test("fact present in baseline but with changed payload is kept", () => {
    const baselineFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic),
    ];
    const currentFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "u" }, schemaPublic), // changed
    ];
    const fb = buildFactBase(currentFacts, []);
    const baseline = buildFactBase(baselineFacts, []);
    const result = subtractBaseline(fb, baseline);
    // tableUsers changed payload → kept
    expect(result.has(tableUsers)).toBe(true);
    expect(result.get(tableUsers)?.payload["persistence"]).toBe("u");
    // schemaPublic unchanged but is parent of kept tableUsers → kept
    expect(result.has(schemaPublic)).toBe(true);
  });

  test("only the changed subtree is kept; unchanged siblings subtracted", () => {
    const baselineFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic),
      makeFact(tableAdmins, { persistence: "p" }, schemaPublic),
    ];
    const currentFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "u" }, schemaPublic), // changed
      makeFact(tableAdmins, { persistence: "p" }, schemaPublic), // same
    ];
    const fb = buildFactBase(currentFacts, []);
    const baseline = buildFactBase(baselineFacts, []);
    const result = subtractBaseline(fb, baseline);
    // tableUsers changed → kept
    expect(result.has(tableUsers)).toBe(true);
    // tableAdmins unchanged → subtracted
    expect(result.has(tableAdmins)).toBe(false);
    // schemaPublic unchanged but is parent of tableUsers → kept
    expect(result.has(schemaPublic)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describe: edge pruning
// ---------------------------------------------------------------------------

describe("subtractBaseline — edge pruning", () => {
  test("an owner->role edge to a subtracted baseline role is retained as dangling", () => {
    const facts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "u" }, schemaPublic), // changed vs baseline
      makeFact(roleOwner),
    ];
    const baselineFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic),
      makeFact(roleOwner),
    ];
    const edge: DependencyEdge = {
      from: tableUsers,
      to: roleOwner,
      kind: "owner",
    };
    const fb = buildFactBase(facts, [edge]);
    const baseline = buildFactBase(baselineFacts, []);
    const result = subtractBaseline(fb, baseline);
    // tableUsers changed → kept; roleOwner unchanged → subtracted. The owner
    // edge is an owner->role edge whose OWNED endpoint (tableUsers) survives, so
    // it is retained as a dangling assumed reference (retainOwnerRoleDangling) —
    // ownership must still serialize as ALTER … OWNER TO the platform role.
    expect([...result.edges]).toHaveLength(1);
    expect(result.get(tableUsers)).toBeDefined();
    // the role fact itself is NOT resurrected — only the edge is retained.
    expect(result.has(roleOwner)).toBe(false);
  });

  test("edges between both surviving facts are kept", () => {
    const facts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "u" }, schemaPublic), // changed
      makeFact(roleOwner, { login: true }), // changed (baseline has false)
    ];
    const baselineFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic),
      makeFact(roleOwner, { login: false }), // different payload
    ];
    const edge: DependencyEdge = {
      from: tableUsers,
      to: roleOwner,
      kind: "owner",
    };
    const fb = buildFactBase(facts, [edge]);
    const baseline = buildFactBase(baselineFacts, []);
    const result = subtractBaseline(fb, baseline);
    // both tableUsers and roleOwner have changed payloads → both survive
    expect(result.has(tableUsers)).toBe(true);
    expect(result.has(roleOwner)).toBe(true);
    // edge between two surviving facts is kept
    expect([...result.edges]).toHaveLength(1);
  });

  test("edges to subtracted facts are pruned", () => {
    const facts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "u" }, schemaPublic), // changed
      makeFact(extPostgis, { version: "3.0" }), // same as baseline → subtracted
    ];
    const baselineFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic),
      makeFact(extPostgis, { version: "3.0" }), // identical
    ];
    const edge: DependencyEdge = {
      from: tableUsers,
      to: extPostgis,
      kind: "memberOfExtension",
    };
    const fb = buildFactBase(facts, [edge]);
    const baseline = buildFactBase(baselineFacts, []);
    const result = subtractBaseline(fb, baseline);
    expect(result.has(tableUsers)).toBe(true);
    expect(result.has(extPostgis)).toBe(false);
    // edge pruned because extPostgis was subtracted
    expect([...result.edges]).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// describe: outgoing-edge signature (payload-equal facts with changed edges)
// ---------------------------------------------------------------------------

describe("subtractBaseline — outgoing-edge signature", () => {
  const roleA: StableId = { kind: "role", name: "a" };
  const roleB: StableId = { kind: "role", name: "b" };

  test("equal-payload fact whose owner edge changed (A→B) is NOT subtracted", () => {
    const shared: Fact[] = [
      makeFact(roleA),
      makeFact(roleB),
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic),
    ];
    const baseline = buildFactBase(shared, [
      { from: tableUsers, to: roleA, kind: "owner" },
    ]);
    const fb = buildFactBase(shared, [
      { from: tableUsers, to: roleB, kind: "owner" },
    ]);
    const result = subtractBaseline(fb, baseline);
    // payload P is identical, but the outgoing owner edge changed → T survives
    // (before the fix it was subtracted on payload hash alone and the drift was
    // invisible).
    expect(result.has(tableUsers)).toBe(true);
    // and it carries its NEW owner->B edge, retained dangling (roleB is a
    // subtracted baseline role).
    const owns = [...result.edges].filter((e) => e.kind === "owner");
    expect(owns).toHaveLength(1);
    expect(encodeId(owns[0]!.to)).toBe(encodeId(roleB));
    // roleB is NOT resurrected as a fact — only the dangling edge is retained.
    expect(result.has(roleB)).toBe(false);
  });

  test("equal payload AND identical owner edge → still fully subtracted", () => {
    const facts: Fact[] = [
      makeFact(roleA),
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic),
    ];
    const edges: DependencyEdge[] = [
      { from: tableUsers, to: roleA, kind: "owner" },
    ];
    const fb = buildFactBase(facts, edges);
    const baseline = buildFactBase(facts, edges);
    const result = subtractBaseline(fb, baseline);
    // identical facts AND identical edges → everything subtracted; the owner
    // edge is NOT retained because its owned endpoint (tableUsers) is gone too.
    expect(result.facts()).toHaveLength(0);
    expect([...result.edges]).toHaveLength(0);
  });

  test("a changed `depends` edge to a subtracted endpoint stays pruned", () => {
    // Only owner->role edges are retained dangling; a `depends` edge to a
    // subtracted fact is pruned as before.
    const baseline = buildFactBase(
      [
        makeFact(schemaPublic),
        makeFact(tableUsers, { persistence: "p" }, schemaPublic),
        makeFact(extPostgis, { version: "3.0" }),
      ],
      [{ from: tableUsers, to: extPostgis, kind: "depends" }],
    );
    const fb = buildFactBase(
      [
        makeFact(schemaPublic),
        makeFact(tableUsers, { persistence: "u" }, schemaPublic), // changed → survives
        makeFact(extPostgis, { version: "3.0" }), // identical → subtracted
      ],
      [{ from: tableUsers, to: extPostgis, kind: "depends" }],
    );
    const result = subtractBaseline(fb, baseline);
    expect(result.has(tableUsers)).toBe(true);
    expect(result.has(extPostgis)).toBe(false);
    expect([...result.edges]).toHaveLength(0);
  });

  test("plan() surfaces an ownership delta that payload-only subtraction hid (e2e)", () => {
    // Both sides keep T (payload differs from the baseline), differing ONLY in
    // the owner edge. Before the fix, Phase 4 pruned the owner->role edge to the
    // subtracted role on BOTH sides, so the ownership change vanished; now the
    // edges are retained dangling and the delta surfaces as a plan action.
    const baseline = buildFactBase(
      [
        makeFact(roleA),
        makeFact(roleB),
        makeFact(schemaPublic),
        makeFact(tableUsers, { persistence: "p0" }, schemaPublic),
      ],
      [{ from: tableUsers, to: roleA, kind: "owner" }],
    );
    const target = buildFactBase(
      [
        makeFact(roleA),
        makeFact(roleB),
        makeFact(schemaPublic),
        makeFact(tableUsers, { persistence: "p1" }, schemaPublic),
      ],
      [{ from: tableUsers, to: roleA, kind: "owner" }],
    );
    const desired = buildFactBase(
      [
        makeFact(roleA),
        makeFact(roleB),
        makeFact(schemaPublic),
        makeFact(tableUsers, { persistence: "p1" }, schemaPublic),
      ],
      [{ from: tableUsers, to: roleB, kind: "owner" }],
    );
    const thePlan = plan(target, desired, { baseline });
    expect(thePlan.actions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// describe: parent-chain preservation
// ---------------------------------------------------------------------------

describe("subtractBaseline — parent-chain preservation", () => {
  test("deeply nested surviving fact forces all ancestors to survive", () => {
    const constraint: StableId = {
      kind: "constraint",
      schema: "public",
      table: "users",
      name: "pk",
    };
    const baselineFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic),
      // constraint not in baseline
    ];
    const currentFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic), // unchanged
      makeFact(constraint, { type: "p" }, tableUsers), // new
    ];
    const fb = buildFactBase(currentFacts, []);
    const baseline = buildFactBase(baselineFacts, []);
    const result = subtractBaseline(fb, baseline);
    // constraint is new → survives
    expect(result.has(constraint)).toBe(true);
    // tableUsers is its parent → force-kept even though it's unchanged vs baseline
    expect(result.has(tableUsers)).toBe(true);
    // schemaPublic is parent of tableUsers → force-kept
    expect(result.has(schemaPublic)).toBe(true);
  });

  test("subtracted parent of no surviving child is removed", () => {
    const baselineFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(schemaPrivate),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic), // same
    ];
    const currentFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(schemaPrivate), // same as baseline → subtracted
      makeFact(tableUsers, { persistence: "p" }, schemaPublic), // same → subtracted
    ];
    const fb = buildFactBase(currentFacts, []);
    const baseline = buildFactBase(baselineFacts, []);
    const result = subtractBaseline(fb, baseline);
    // All facts identical in baseline → all subtracted
    expect(result.facts()).toHaveLength(0);
  });

  test("multi-level parent chain: only relevant branch kept", () => {
    // schemaPublic → tableUsers → colId   (colId changes)
    // schemaPrivate → tableAdmins → colAdmin  (all same as baseline)
    const colAdmin: StableId = {
      kind: "column",
      schema: "private",
      table: "admins",
      name: "id",
    };
    const tableAdminsPrivate: StableId = {
      kind: "table",
      schema: "private",
      name: "admins",
    };
    const baselineFacts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(schemaPrivate),
      makeFact(tableUsers, { persistence: "p" }, schemaPublic),
      makeFact(colId, { type: "integer" }, tableUsers),
      makeFact(tableAdminsPrivate, { persistence: "p" }, schemaPrivate),
      makeFact(colAdmin, { type: "integer" }, tableAdminsPrivate),
    ];
    const currentFacts: Fact[] = [
      ...baselineFacts.slice(0, 3), // schemaPublic, schemaPrivate, tableUsers
      makeFact(colId, { type: "bigint" }, tableUsers), // changed!
      ...baselineFacts.slice(4), // tableAdminsPrivate, colAdmin — same
    ];
    const fb = buildFactBase(currentFacts, []);
    const baseline = buildFactBase(baselineFacts, []);
    const result = subtractBaseline(fb, baseline);
    // colId changed → kept
    expect(result.has(colId)).toBe(true);
    // tableUsers and schemaPublic are ancestors → force-kept
    expect(result.has(tableUsers)).toBe(true);
    expect(result.has(schemaPublic)).toBe(true);
    // schemaPrivate branch all unchanged → subtracted
    expect(result.has(schemaPrivate)).toBe(false);
    expect(result.has(tableAdminsPrivate)).toBe(false);
    expect(result.has(colAdmin)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: FactBase integrity
// ---------------------------------------------------------------------------

describe("subtractBaseline — FactBase integrity", () => {
  test("result FactBase has no diagnostics for edges between surviving facts", () => {
    const facts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "u" }, schemaPublic),
      makeFact(roleOwner, { login: true }),
    ];
    const edge: DependencyEdge = {
      from: tableUsers,
      to: roleOwner,
      kind: "owner",
    };
    // baseline has nothing → all facts survive
    const fb = buildFactBase(facts, [edge]);
    const baseline = buildFactBase([], []);
    const result = subtractBaseline(fb, baseline);
    expect(result.diagnostics).toHaveLength(0);
    expect([...result.edges]).toHaveLength(1);
  });

  test("result FactBase rootHash is deterministic", () => {
    const facts: Fact[] = [
      makeFact(schemaPublic),
      makeFact(tableUsers, { persistence: "u" }, schemaPublic),
    ];
    const fb = buildFactBase(facts, []);
    const baseline = buildFactBase([], []);
    const r1 = subtractBaseline(fb, baseline);
    const r2 = subtractBaseline(fb, baseline);
    expect(r1.rootHash).toBe(r2.rootHash);
  });
});
