/**
 * Unit tests for the Policy DSL v2 (src/policy/policy.ts).
 * No Docker / database required.
 */

import { describe, expect, test } from "bun:test";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import {
  deltaMatches,
  factMatches,
  filterDeltas,
  flattenPolicy,
  validatePolicy,
  type Policy,
  type Predicate,
} from "./policy.ts";
import type { Delta } from "../core/diff.ts";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const schemaPublic: StableId = { kind: "schema", name: "public" };
const schemaAuth: StableId = { kind: "schema", name: "auth" };
const tableUsers: StableId = { kind: "table", schema: "public", name: "users" };
const tableRoles: StableId = {
  kind: "table",
  schema: "auth",
  name: "roles",
};
const colId: StableId = {
  kind: "column",
  schema: "public",
  table: "users",
  name: "id",
};
const extPostgis: StableId = { kind: "extension", name: "postgis" };
const roleOwner: StableId = { kind: "role", name: "owner" };

function makeFactBase(facts: Fact[], edges: DependencyEdge[] = []) {
  return buildFactBase(facts, edges);
}

function baseFacts(): Fact[] {
  return [
    { id: schemaPublic, payload: {} },
    { id: schemaAuth, payload: {} },
    { id: tableUsers, parent: schemaPublic, payload: { persistence: "p" } },
    { id: tableRoles, parent: schemaAuth, payload: { persistence: "p" } },
    { id: colId, parent: tableUsers, payload: { type: "integer" } },
    { id: extPostgis, payload: { version: "3.0" } },
    { id: roleOwner, payload: { login: true } },
  ];
}

// ---------------------------------------------------------------------------
// describe: factMatches — primitive predicates
// ---------------------------------------------------------------------------

describe("factMatches — kind", () => {
  const fb = makeFactBase(baseFacts());

  test("single kind matches", () => {
    const fact = fb.get(tableUsers)!;
    expect(factMatches({ kind: "table" }, fact, fb)).toBe(true);
  });

  test("single kind does not match different kind", () => {
    const fact = fb.get(schemaPublic)!;
    expect(factMatches({ kind: "table" }, fact, fb)).toBe(false);
  });

  test("array kind matches any of listed kinds", () => {
    const fact = fb.get(schemaPublic)!;
    expect(factMatches({ kind: ["table", "schema"] }, fact, fb)).toBe(true);
  });

  test("array kind does not match if none listed", () => {
    const fact = fb.get(roleOwner)!;
    expect(factMatches({ kind: ["table", "schema"] }, fact, fb)).toBe(false);
  });
});

describe("factMatches — schema", () => {
  const fb = makeFactBase(baseFacts());

  test("exact schema matches", () => {
    const fact = fb.get(tableUsers)!;
    expect(factMatches({ schema: "public" }, fact, fb)).toBe(true);
  });

  test("exact schema does not match wrong schema", () => {
    const fact = fb.get(tableRoles)!;
    expect(factMatches({ schema: "public" }, fact, fb)).toBe(false);
  });

  test("glob * matches any schema", () => {
    const fact = fb.get(tableUsers)!;
    expect(factMatches({ schema: "*" }, fact, fb)).toBe(true);
  });

  test("glob prefix matches", () => {
    const fact = fb.get(tableUsers)!;
    expect(factMatches({ schema: "pub*" }, fact, fb)).toBe(true);
  });

  test("glob does not match unrelated schema", () => {
    const fact = fb.get(tableRoles)!;
    expect(factMatches({ schema: "pub*" }, fact, fb)).toBe(false);
  });

  test("fact without schema field returns false", () => {
    const fact = fb.get(roleOwner)!;
    expect(factMatches({ schema: "*" }, fact, fb)).toBe(false);
  });
});

describe("factMatches — name", () => {
  const fb = makeFactBase(baseFacts());

  test("exact name matches", () => {
    const fact = fb.get(tableUsers)!;
    expect(factMatches({ name: "users" }, fact, fb)).toBe(true);
  });

  test("glob name matches", () => {
    const fact = fb.get(tableUsers)!;
    expect(factMatches({ name: "user*" }, fact, fb)).toBe(true);
  });

  test("name does not match on fact without name field", () => {
    // membership facts have role/member, no name
    const fact: Fact = {
      id: { kind: "membership", role: "a", member: "b" },
      payload: {},
    };
    const local = makeFactBase([fact]);
    expect(factMatches({ name: "*" }, fact, local)).toBe(false);
  });
});

describe("factMatches — verb", () => {
  const fb = makeFactBase(baseFacts());

  test("verb predicate always returns false on factMatches (no verb on facts)", () => {
    const fact = fb.get(tableUsers)!;
    expect(factMatches({ verb: "add" }, fact, fb)).toBe(false);
    expect(factMatches({ verb: ["add", "remove"] }, fact, fb)).toBe(false);
  });
});

describe("factMatches — ownedByExtension", () => {
  test("matches when fact has memberOfExtension edge to named extension", () => {
    const geomCol: StableId = {
      kind: "column",
      schema: "public",
      table: "geo",
      name: "geom",
    };
    const geoTable: StableId = {
      kind: "table",
      schema: "public",
      name: "geo",
    };
    const facts: Fact[] = [
      { id: schemaPublic, payload: {} },
      { id: extPostgis, payload: {} },
      { id: geoTable, parent: schemaPublic, payload: {} },
      { id: geomCol, parent: geoTable, payload: {} },
    ];
    const edges: DependencyEdge[] = [
      { from: geoTable, to: extPostgis, kind: "memberOfExtension" },
    ];
    const fb = makeFactBase(facts, edges);
    const col = fb.get(geomCol)!;
    // Column's parent (geoTable) is owned by postgis
    expect(factMatches({ ownedByExtension: "postgis" }, col, fb)).toBe(true);
  });

  test("does not match when no memberOfExtension edge exists", () => {
    const fb = makeFactBase(baseFacts());
    const fact = fb.get(tableUsers)!;
    expect(factMatches({ ownedByExtension: "postgis" }, fact, fb)).toBe(false);
  });

  test("does not match a different extension name", () => {
    const facts: Fact[] = [
      { id: schemaPublic, payload: {} },
      { id: extPostgis, payload: {} },
      { id: tableUsers, parent: schemaPublic, payload: {} },
    ];
    const edges: DependencyEdge[] = [
      { from: tableUsers, to: extPostgis, kind: "memberOfExtension" },
    ];
    const fb = makeFactBase(facts, edges);
    const fact = fb.get(tableUsers)!;
    expect(factMatches({ ownedByExtension: "pgcrypto" }, fact, fb)).toBe(false);
  });
});

describe("factMatches — parentKind", () => {
  const fb = makeFactBase(baseFacts());

  test("matches when parent has the given kind", () => {
    const col = fb.get(colId)!;
    expect(factMatches({ parentKind: "table" }, col, fb)).toBe(true);
  });

  test("does not match when parent has a different kind", () => {
    const col = fb.get(colId)!;
    expect(factMatches({ parentKind: "schema" }, col, fb)).toBe(false);
  });

  test("returns false for root facts (no parent)", () => {
    const schema = fb.get(schemaPublic)!;
    expect(factMatches({ parentKind: "table" }, schema, fb)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: factMatches — combinators
// ---------------------------------------------------------------------------

describe("factMatches — combinators", () => {
  const fb = makeFactBase(baseFacts());
  const tableUsersFact = fb.get(tableUsers)!;

  test("all: both true → true", () => {
    const p: Predicate = {
      all: [{ kind: "table" }, { schema: "public" }],
    };
    expect(factMatches(p, tableUsersFact, fb)).toBe(true);
  });

  test("all: one false → false", () => {
    const p: Predicate = {
      all: [{ kind: "table" }, { schema: "auth" }],
    };
    expect(factMatches(p, tableUsersFact, fb)).toBe(false);
  });

  test("all: empty array → true (vacuously)", () => {
    expect(factMatches({ all: [] }, tableUsersFact, fb)).toBe(true);
  });

  test("any: one true → true", () => {
    const p: Predicate = {
      any: [{ kind: "schema" }, { kind: "table" }],
    };
    expect(factMatches(p, tableUsersFact, fb)).toBe(true);
  });

  test("any: all false → false", () => {
    const p: Predicate = {
      any: [{ kind: "schema" }, { kind: "role" }],
    };
    expect(factMatches(p, tableUsersFact, fb)).toBe(false);
  });

  test("any: empty array → false (vacuously)", () => {
    expect(factMatches({ any: [] }, tableUsersFact, fb)).toBe(false);
  });

  test("not: negates true to false", () => {
    expect(factMatches({ not: { kind: "table" } }, tableUsersFact, fb)).toBe(
      false,
    );
  });

  test("not: negates false to true", () => {
    expect(factMatches({ not: { kind: "schema" } }, tableUsersFact, fb)).toBe(
      true,
    );
  });

  test("nested combinators", () => {
    const p: Predicate = {
      all: [
        { not: { kind: "schema" } },
        { any: [{ schema: "public" }, { schema: "auth" }] },
      ],
    };
    // tableUsers: not schema ✓, schema=public ✓
    expect(factMatches(p, tableUsersFact, fb)).toBe(true);
    // schemaPublic: is schema → not-schema fails
    expect(factMatches(p, fb.get(schemaPublic)!, fb)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: deltaMatches
// ---------------------------------------------------------------------------

describe("deltaMatches — verb predicate", () => {
  const fb = makeFactBase(baseFacts());
  const emptyFb = makeFactBase([]);

  const addDelta: Delta = {
    verb: "add",
    fact: { id: tableUsers, payload: {} },
  };
  const removeDelta: Delta = {
    verb: "remove",
    fact: { id: tableUsers, payload: {} },
  };

  test("single verb matches", () => {
    expect(deltaMatches({ verb: "add" }, addDelta, emptyFb, fb)).toBe(true);
  });

  test("single verb does not match other verb", () => {
    expect(deltaMatches({ verb: "remove" }, addDelta, emptyFb, fb)).toBe(false);
  });

  test("array verb matches any", () => {
    expect(deltaMatches({ verb: ["add", "set"] }, addDelta, emptyFb, fb)).toBe(
      true,
    );
  });

  test("array verb does not match if none in list", () => {
    expect(
      deltaMatches({ verb: ["remove", "set"] }, addDelta, emptyFb, fb),
    ).toBe(false);
  });

  test("verb predicate on remove delta", () => {
    expect(deltaMatches({ verb: "remove" }, removeDelta, fb, emptyFb)).toBe(
      true,
    );
  });
});

describe("deltaMatches — fact predicates on various delta verbs", () => {
  const source = makeFactBase(baseFacts());
  const desired = makeFactBase(baseFacts());
  const emptyFb = makeFactBase([]);

  test("add delta subject resolved from desired", () => {
    const addDelta: Delta = {
      verb: "add",
      fact: { id: tableUsers, parent: schemaPublic, payload: {} },
    };
    expect(deltaMatches({ kind: "table" }, addDelta, emptyFb, desired)).toBe(
      true,
    );
    expect(deltaMatches({ schema: "public" }, addDelta, emptyFb, desired)).toBe(
      true,
    );
  });

  test("remove delta subject resolved from source", () => {
    const removeDelta: Delta = {
      verb: "remove",
      fact: { id: tableUsers, parent: schemaPublic, payload: {} },
    };
    expect(deltaMatches({ kind: "table" }, removeDelta, source, emptyFb)).toBe(
      true,
    );
  });

  test("set delta subject resolved from desired", () => {
    const setDelta: Delta = {
      verb: "set",
      id: tableUsers,
      attr: "persistence",
      from: "p",
      to: "u",
    };
    expect(deltaMatches({ kind: "table" }, setDelta, source, desired)).toBe(
      true,
    );
  });

  test("link delta subject resolved from desired.from", () => {
    const linkDelta: Delta = {
      verb: "link",
      edge: { from: tableUsers, to: roleOwner, kind: "owner" },
    };
    expect(deltaMatches({ kind: "table" }, linkDelta, source, desired)).toBe(
      true,
    );
  });

  test("unlink delta subject resolved from source.from", () => {
    const unlinkDelta: Delta = {
      verb: "unlink",
      edge: { from: tableUsers, to: roleOwner, kind: "owner" },
    };
    expect(deltaMatches({ kind: "table" }, unlinkDelta, source, desired)).toBe(
      true,
    );
  });
});

describe("deltaMatches — combinators on deltas", () => {
  const source = makeFactBase(baseFacts());
  const desired = makeFactBase(baseFacts());

  test("all combinator on delta", () => {
    const addDelta: Delta = {
      verb: "add",
      fact: { id: tableUsers, parent: schemaPublic, payload: {} },
    };
    const p: Predicate = {
      all: [{ verb: "add" }, { kind: "table" }, { schema: "public" }],
    };
    expect(deltaMatches(p, addDelta, source, desired)).toBe(true);
  });

  test("not combinator on delta verb", () => {
    const addDelta: Delta = {
      verb: "add",
      fact: { id: tableUsers, payload: {} },
    };
    expect(
      deltaMatches({ not: { verb: "remove" } }, addDelta, source, desired),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describe: filterDeltas — first-match-wins, include/exclude, kept/filtered
// ---------------------------------------------------------------------------

describe("filterDeltas", () => {
  const source = makeFactBase(baseFacts());

  // Desired has a new table in auth schema
  const newTable: StableId = {
    kind: "table",
    schema: "auth",
    name: "sessions",
  };
  const desiredFacts: Fact[] = [
    ...baseFacts(),
    { id: newTable, parent: schemaAuth, payload: {} },
  ];
  const desired = makeFactBase(desiredFacts);

  const addUsers: Delta = {
    verb: "add",
    fact: { id: tableUsers, parent: schemaPublic, payload: {} },
  };
  const addAuthSessions: Delta = {
    verb: "add",
    fact: { id: newTable, parent: schemaAuth, payload: {} },
  };
  const removeRole: Delta = {
    verb: "remove",
    fact: { id: roleOwner, payload: {} },
  };

  const deltas: Delta[] = [addUsers, addAuthSessions, removeRole];

  test("no rules → all deltas kept", () => {
    const policy: Policy = { id: "empty" };
    const { kept, filtered } = filterDeltas(deltas, policy, source, desired);
    expect(kept).toHaveLength(3);
    expect(filtered).toHaveLength(0);
  });

  test("exclude auth schema — tables in auth are filtered", () => {
    const policy: Policy = {
      id: "no-auth",
      filter: [{ match: { schema: "auth" }, action: "exclude" }],
    };
    const { kept, filtered } = filterDeltas(deltas, policy, source, desired);
    expect(kept).toHaveLength(2);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toBe(addAuthSessions);
  });

  test("first-match-wins: include before exclude", () => {
    // include public tables first, then exclude all tables
    const policy: Policy = {
      id: "first-match",
      filter: [
        {
          match: { all: [{ kind: "table" }, { schema: "public" }] },
          action: "include",
        },
        { match: { kind: "table" }, action: "exclude" },
      ],
    };
    const { kept, filtered } = filterDeltas(deltas, policy, source, desired);
    // addUsers (table+public) → matched by rule 1 → include
    // addAuthSessions (table+auth) → not matched by rule 1, matched by rule 2 → exclude
    // removeRole → no match → include
    expect(kept).toHaveLength(2);
    expect(kept).toContain(addUsers);
    expect(kept).toContain(removeRole);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toBe(addAuthSessions);
  });

  test("exclude then include (include-after-exclude): the exclude wins first", () => {
    // exclude auth schema first, then re-include everything
    const policy: Policy = {
      id: "excl-then-incl",
      filter: [
        { match: { schema: "auth" }, action: "exclude" },
        { match: { all: [] }, action: "include" },
      ],
    };
    const { filtered } = filterDeltas(deltas, policy, source, desired);
    // addAuthSessions matches rule 1 → excluded (first-match-wins)
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toBe(addAuthSessions);
  });

  test("filtered deltas are returned, not silently dropped", () => {
    const policy: Policy = {
      id: "exclude-all",
      filter: [{ match: { all: [] }, action: "exclude" }],
    };
    const { kept, filtered } = filterDeltas(deltas, policy, source, desired);
    expect(kept).toHaveLength(0);
    expect(filtered).toHaveLength(3);
  });

  test("exclude by verb", () => {
    const policy: Policy = {
      id: "no-remove",
      filter: [{ match: { verb: "remove" }, action: "exclude" }],
    };
    const { kept, filtered } = filterDeltas(deltas, policy, source, desired);
    expect(kept).toHaveLength(2);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toBe(removeRole);
  });
});

// ---------------------------------------------------------------------------
// describe: extends composition
// ---------------------------------------------------------------------------

describe("flattenPolicy — extends composition", () => {
  test("own rules before parent rules", () => {
    const parent: Policy = {
      id: "parent",
      filter: [{ match: { kind: "schema" }, action: "exclude" }],
    };
    const child: Policy = {
      id: "child",
      filter: [{ match: { kind: "role" }, action: "exclude" }],
      extends: [parent],
    };
    const flat = flattenPolicy(child);
    expect(flat.filter).toHaveLength(2);
    // child rule first
    expect(flat.filter[0]?.match).toEqual({ kind: "role" });
    // parent rule second
    expect(flat.filter[1]?.match).toEqual({ kind: "schema" });
  });

  test("multiple parents: rules appended in extends array order", () => {
    const p1: Policy = {
      id: "p1",
      filter: [{ match: { kind: "role" }, action: "exclude" }],
    };
    const p2: Policy = {
      id: "p2",
      filter: [{ match: { kind: "schema" }, action: "exclude" }],
    };
    const child: Policy = { id: "child", extends: [p1, p2] };
    const flat = flattenPolicy(child);
    expect(flat.filter[0]?.match).toEqual({ kind: "role" });
    expect(flat.filter[1]?.match).toEqual({ kind: "schema" });
  });

  test("deep extends: own → child → grandparent order", () => {
    const gp: Policy = {
      id: "grandparent",
      filter: [{ match: { kind: "extension" }, action: "exclude" }],
    };
    const parent: Policy = {
      id: "parent-deep",
      filter: [{ match: { kind: "role" }, action: "exclude" }],
      extends: [gp],
    };
    const child: Policy = {
      id: "child-deep",
      filter: [{ match: { kind: "schema" }, action: "exclude" }],
      extends: [parent],
    };
    const flat = flattenPolicy(child);
    expect(flat.filter.map((r) => (r.match as { kind: string }).kind)).toEqual([
      "schema",
      "role",
      "extension",
    ]);
  });

  test("serialize rules from extends are also appended", () => {
    const parent: Policy = {
      id: "parent-serialize",
      serialize: [{ match: { all: [] }, params: { concurrentIndexes: true } }],
    };
    const child: Policy = { id: "child-serialize", extends: [parent] };
    const flat = flattenPolicy(child);
    expect(flat.serialize).toHaveLength(1);
    expect(flat.serialize[0]?.params).toEqual({ concurrentIndexes: true });
  });

  test("baseline from own policy is preserved", () => {
    const policy: Policy = {
      id: "with-baseline",
      baseline: "supabase-17.6",
    };
    const flat = flattenPolicy(policy);
    expect(flat.baseline).toBe("supabase-17.6");
  });

  test("assumedRoles compose across extends and de-duplicate", () => {
    const parent: Policy = {
      id: "parent-assumed",
      assumedRoles: ["anon", "authenticated"],
    };
    const child: Policy = {
      id: "child-assumed",
      assumedRoles: ["anon", "service_role"],
      extends: [parent],
    };
    const flat = flattenPolicy(child);
    expect([...flat.assumedRoles].sort()).toEqual([
      "anon",
      "authenticated",
      "service_role",
    ]);
  });

  test("assumedRoles defaults to empty array when unset", () => {
    const flat = flattenPolicy({ id: "no-assumed" });
    expect(flat.assumedRoles).toEqual([]);
  });

  test("assumedSchemas compose across extends and de-duplicate", () => {
    const parent: Policy = {
      id: "parent-assumed-schemas",
      assumedSchemas: ["extensions", "auth"],
    };
    const child: Policy = {
      id: "child-assumed-schemas",
      assumedSchemas: ["extensions", "storage"],
      extends: [parent],
    };
    const flat = flattenPolicy(child);
    expect([...flat.assumedSchemas].sort()).toEqual([
      "auth",
      "extensions",
      "storage",
    ]);
  });

  test("assumedSchemas defaults to empty array when unset", () => {
    const flat = flattenPolicy({ id: "no-assumed-schemas" });
    expect(flat.assumedSchemas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// describe: cycle detection
// ---------------------------------------------------------------------------

describe("flattenPolicy / validatePolicy — cycle detection", () => {
  test("direct self-cycle throws", () => {
    const policy: Policy = { id: "cyclic" };
    // Wire up a cycle manually by using the object itself in its extends
    (policy as { extends?: Policy[] }).extends = [policy];
    expect(() => flattenPolicy(policy)).toThrow(/cycle/i);
  });

  test("indirect cycle throws", () => {
    const a: Policy = { id: "a" };
    const b: Policy = { id: "b", extends: [a] };
    (a as { extends?: Policy[] }).extends = [b];
    expect(() => flattenPolicy(a)).toThrow(/cycle/i);
  });

  test("diamond inheritance (no cycle) does not throw", () => {
    const base: Policy = {
      id: "base",
      filter: [{ match: { kind: "extension" }, action: "exclude" }],
    };
    const left: Policy = { id: "left", extends: [base] };
    const right: Policy = { id: "right", extends: [base] };
    const top: Policy = { id: "top", extends: [left, right] };
    // Should not throw
    expect(() => flattenPolicy(top)).not.toThrow();
    // base rules appear twice (once through each branch) — acceptable
    const flat = flattenPolicy(top);
    expect(flat.filter.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// describe: validatePolicy — unknown param names
// ---------------------------------------------------------------------------

describe("validatePolicy — serialize param validation", () => {
  test("known param does not throw", () => {
    const policy: Policy = {
      id: "valid",
      serialize: [{ match: { all: [] }, params: { concurrentIndexes: true } }],
    };
    expect(() => validatePolicy(policy)).not.toThrow();
  });

  test("unknown param throws with the param name in the message", () => {
    const policy: Policy = {
      id: "invalid",
      serialize: [{ match: { all: [] }, params: { skipEverything: true } }],
    };
    expect(() => validatePolicy(policy)).toThrow(/skipEverything/);
  });

  test("unknown param in extended policy also throws", () => {
    const parent: Policy = {
      id: "parent-invalid",
      serialize: [{ match: { all: [] }, params: { unknownParam: 42 } }],
    };
    const child: Policy = {
      id: "child-inherit",
      extends: [parent],
    };
    expect(() => validatePolicy(child)).toThrow(/unknownParam/);
  });
});

// ---------------------------------------------------------------------------
// describe: factMatches — new predicates (stage-8 vocabulary extensions)
// ---------------------------------------------------------------------------

describe("factMatches — owner predicate", () => {
  test("matches when payload owner is the given string", () => {
    const fact: Fact = {
      id: { kind: "table", schema: "public", name: "t" },
      payload: { owner: "postgres" },
    };
    const fb = buildFactBase(
      [{ id: { kind: "schema", name: "public" }, payload: {} }, fact],
      [],
    );
    expect(factMatches({ owner: "postgres" }, fact, fb)).toBe(true);
  });

  test("matches any glob in array", () => {
    const fact: Fact = {
      id: { kind: "table", schema: "public", name: "t" },
      payload: { owner: "supabase_admin" },
    };
    const fb = buildFactBase(
      [{ id: { kind: "schema", name: "public" }, payload: {} }, fact],
      [],
    );
    expect(factMatches({ owner: ["anon", "supabase_admin"] }, fact, fb)).toBe(
      true,
    );
  });

  test("does not match when owner differs", () => {
    const fact: Fact = {
      id: { kind: "table", schema: "public", name: "t" },
      payload: { owner: "app_user" },
    };
    const fb = buildFactBase(
      [{ id: { kind: "schema", name: "public" }, payload: {} }, fact],
      [],
    );
    expect(factMatches({ owner: "postgres" }, fact, fb)).toBe(false);
  });

  test("returns false when payload has no owner field", () => {
    const fact: Fact = {
      id: { kind: "schema", name: "public" },
      payload: {},
    };
    const fb = buildFactBase([fact], []);
    expect(factMatches({ owner: "postgres" }, fact, fb)).toBe(false);
  });

  test("glob pattern in owner predicate", () => {
    const fact: Fact = {
      id: { kind: "table", schema: "public", name: "t" },
      payload: { owner: "supabase_storage_admin" },
    };
    const fb = buildFactBase(
      [{ id: { kind: "schema", name: "public" }, payload: {} }, fact],
      [],
    );
    expect(factMatches({ owner: "supabase_*" }, fact, fb)).toBe(true);
  });
});

describe("factMatches — idField predicate", () => {
  test("matches membership.role when role is in list", () => {
    const fact: Fact = {
      id: { kind: "membership", role: "supabase_admin", member: "postgres" },
      payload: {},
    };
    const fb = buildFactBase([fact], []);
    expect(
      factMatches(
        { idField: { field: "role", glob: ["anon", "supabase_admin"] } },
        fact,
        fb,
      ),
    ).toBe(true);
  });

  test("matches membership.member with glob", () => {
    const fact: Fact = {
      id: {
        kind: "membership",
        role: "postgres",
        member: "supabase_storage_admin",
      },
      payload: {},
    };
    const fb = buildFactBase([fact], []);
    expect(
      factMatches(
        { idField: { field: "member", glob: "supabase_*" } },
        fact,
        fb,
      ),
    ).toBe(true);
  });

  test("does not match when field value differs from glob", () => {
    const fact: Fact = {
      id: { kind: "membership", role: "app_role", member: "app_user" },
      payload: {},
    };
    const fb = buildFactBase([fact], []);
    expect(
      factMatches({ idField: { field: "role", glob: "supabase_*" } }, fact, fb),
    ).toBe(false);
  });

  test("scopes an extensionIntent fact by ext / intentKind / key", () => {
    const fact: Fact = {
      id: {
        kind: "extensionIntent",
        ext: "pg_cron",
        intentKind: "job",
        key: "nightly_prune",
      },
      payload: {},
    };
    const fb = buildFactBase([fact], []);
    expect(
      factMatches({ idField: { field: "ext", glob: "pg_cron" } }, fact, fb),
    ).toBe(true);
    expect(
      factMatches({ idField: { field: "intentKind", glob: "job" } }, fact, fb),
    ).toBe(true);
    expect(
      factMatches({ idField: { field: "key", glob: "nightly_*" } }, fact, fb),
    ).toBe(true);
    expect(
      factMatches({ idField: { field: "key", glob: "hourly_*" } }, fact, fb),
    ).toBe(false);
  });

  test("returns false when field does not exist on id", () => {
    const fact: Fact = {
      id: { kind: "schema", name: "public" },
      payload: {},
    };
    const fb = buildFactBase([fact], []);
    expect(
      factMatches({ idField: { field: "member", glob: "*" } }, fact, fb),
    ).toBe(false);
  });

  test("matches trigger table name via idField", () => {
    const fact: Fact = {
      id: {
        kind: "trigger",
        schema: "pgmq",
        table: "q_myqueue",
        name: "my_trigger",
      },
      payload: {},
    };
    const fb = buildFactBase(
      [
        { id: { kind: "schema", name: "pgmq" }, payload: {} },
        {
          id: { kind: "table", schema: "pgmq", name: "q_myqueue" },
          payload: {},
        },
        fact,
      ],
      [],
    );
    expect(
      factMatches({ idField: { field: "table", glob: "q_*" } }, fact, fb),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describe: factMatches — target predicate (unified replacement for
// targetKind / targetSchema / targetName)
// ---------------------------------------------------------------------------

describe("factMatches — target predicate (kind sub-field)", () => {
  test("matches acl fact targeting fdw via target.kind", () => {
    const fdwId: StableId = { kind: "fdw", name: "postgres_fdw" };
    const aclId: StableId = { kind: "acl", target: fdwId, grantee: "postgres" };
    const fact: Fact = { id: aclId, payload: {} };
    const fb = buildFactBase([{ id: fdwId, payload: {} }, fact], []);
    expect(factMatches({ target: { kind: "fdw" } }, fact, fb)).toBe(true);
  });

  test("does not match when target kind differs", () => {
    const tableId: StableId = { kind: "table", schema: "public", name: "t" };
    const aclId: StableId = {
      kind: "acl",
      target: tableId,
      grantee: "postgres",
    };
    const fact: Fact = { id: aclId, payload: {} };
    const schemaFact: Fact = {
      id: { kind: "schema", name: "public" },
      payload: {},
    };
    const tableFact: Fact = {
      id: tableId,
      parent: { kind: "schema", name: "public" },
      payload: {},
    };
    const fb = buildFactBase([schemaFact, tableFact, fact], []);
    expect(factMatches({ target: { kind: "fdw" } }, fact, fb)).toBe(false);
  });

  test("matches array of target kinds via target.kind", () => {
    const fdwId: StableId = { kind: "fdw", name: "my_fdw" };
    const aclId: StableId = { kind: "acl", target: fdwId, grantee: "pg" };
    const fact: Fact = { id: aclId, payload: {} };
    const fb = buildFactBase([{ id: fdwId, payload: {} }, fact], []);
    expect(factMatches({ target: { kind: ["fdw", "server"] } }, fact, fb)).toBe(
      true,
    );
  });

  test("returns false when id has no target field", () => {
    const fact: Fact = {
      id: { kind: "schema", name: "public" },
      payload: {},
    };
    const fb = buildFactBase([fact], []);
    expect(factMatches({ target: { kind: "fdw" } }, fact, fb)).toBe(false);
  });
});

describe("factMatches — target predicate (schema sub-field)", () => {
  test("matches acl whose target lives in a system schema via target.schema", () => {
    const tableId: StableId = { kind: "table", schema: "auth", name: "users" };
    const aclId: StableId = { kind: "acl", target: tableId, grantee: "anon" };
    const schemaFact: Fact = {
      id: { kind: "schema", name: "auth" },
      payload: {},
    };
    const tableFact: Fact = {
      id: tableId,
      parent: { kind: "schema", name: "auth" },
      payload: {},
    };
    const fact: Fact = { id: aclId, payload: {} };
    const fb = buildFactBase([schemaFact, tableFact, fact], []);
    expect(factMatches({ target: { schema: "auth" } }, fact, fb)).toBe(true);
  });

  test("does not match when target schema differs", () => {
    const tableId: StableId = { kind: "table", schema: "public", name: "t" };
    const aclId: StableId = { kind: "acl", target: tableId, grantee: "anon" };
    const schemaFact: Fact = {
      id: { kind: "schema", name: "public" },
      payload: {},
    };
    const tableFact: Fact = {
      id: tableId,
      parent: { kind: "schema", name: "public" },
      payload: {},
    };
    const fact: Fact = { id: aclId, payload: {} };
    const fb = buildFactBase([schemaFact, tableFact, fact], []);
    expect(factMatches({ target: { schema: "auth" } }, fact, fb)).toBe(false);
  });

  test("matches array of target schemas via target.schema", () => {
    const tableId: StableId = {
      kind: "table",
      schema: "storage",
      name: "objects",
    };
    const aclId: StableId = { kind: "acl", target: tableId, grantee: "anon" };
    const schemaFact: Fact = {
      id: { kind: "schema", name: "storage" },
      payload: {},
    };
    const tableFact: Fact = {
      id: tableId,
      parent: { kind: "schema", name: "storage" },
      payload: {},
    };
    const fact: Fact = { id: aclId, payload: {} };
    const fb = buildFactBase([schemaFact, tableFact, fact], []);
    expect(
      factMatches({ target: { schema: ["auth", "storage"] } }, fact, fb),
    ).toBe(true);
  });

  test("returns false for facts without target in id", () => {
    const fact: Fact = {
      id: { kind: "schema", name: "public" },
      payload: {},
    };
    const fb = buildFactBase([fact], []);
    expect(factMatches({ target: { schema: "auth" } }, fact, fb)).toBe(false);
  });
});

describe("factMatches — target predicate (name sub-field)", () => {
  test("matches acl whose target has the given name (schema-kind target)", () => {
    const schemaId: StableId = { kind: "schema", name: "auth" };
    const aclId: StableId = { kind: "acl", target: schemaId, grantee: "anon" };
    const schemaFact: Fact = { id: schemaId, payload: {} };
    const aclFact: Fact = { id: aclId, payload: {} };
    const fb = buildFactBase([schemaFact, aclFact], []);
    expect(factMatches({ target: { name: "auth" } }, aclFact, fb)).toBe(true);
  });

  test("does not match when target name differs", () => {
    const schemaId: StableId = { kind: "schema", name: "public" };
    const aclId: StableId = { kind: "acl", target: schemaId, grantee: "anon" };
    const schemaFact: Fact = { id: schemaId, payload: {} };
    const aclFact: Fact = { id: aclId, payload: {} };
    const fb = buildFactBase([schemaFact, aclFact], []);
    expect(factMatches({ target: { name: "auth" } }, aclFact, fb)).toBe(false);
  });

  test("matches array of target names", () => {
    const schemaId: StableId = { kind: "schema", name: "storage" };
    const aclId: StableId = { kind: "acl", target: schemaId, grantee: "anon" };
    const schemaFact: Fact = { id: schemaId, payload: {} };
    const aclFact: Fact = { id: aclId, payload: {} };
    const fb = buildFactBase([schemaFact, aclFact], []);
    expect(
      factMatches({ target: { name: ["auth", "storage"] } }, aclFact, fb),
    ).toBe(true);
  });

  test("returns false for facts without target in id", () => {
    const fact: Fact = { id: { kind: "schema", name: "public" }, payload: {} };
    const fb = buildFactBase([fact], []);
    expect(factMatches({ target: { name: "auth" } }, fact, fb)).toBe(false);
  });
});

describe("factMatches — target predicate (combined sub-fields)", () => {
  test("matches when all provided sub-fields match (kind + name)", () => {
    const schemaId: StableId = { kind: "schema", name: "auth" };
    const aclId: StableId = { kind: "acl", target: schemaId, grantee: "anon" };
    const schemaFact: Fact = { id: schemaId, payload: {} };
    const aclFact: Fact = { id: aclId, payload: {} };
    const fb = buildFactBase([schemaFact, aclFact], []);
    expect(
      factMatches({ target: { kind: "schema", name: "auth" } }, aclFact, fb),
    ).toBe(true);
  });

  test("fails when only one of two sub-fields matches (kind + name mismatch)", () => {
    const schemaId: StableId = { kind: "schema", name: "public" };
    const aclId: StableId = { kind: "acl", target: schemaId, grantee: "anon" };
    const schemaFact: Fact = { id: schemaId, payload: {} };
    const aclFact: Fact = { id: aclId, payload: {} };
    const fb = buildFactBase([schemaFact, aclFact], []);
    // kind matches ("schema") but name does not ("public" != "auth")
    expect(
      factMatches({ target: { kind: "schema", name: "auth" } }, aclFact, fb),
    ).toBe(false);
  });

  test("empty target predicate {} matches any fact with a target field", () => {
    const fdwId: StableId = { kind: "fdw", name: "my_fdw" };
    const aclId: StableId = { kind: "acl", target: fdwId, grantee: "pg" };
    const aclFact: Fact = { id: aclId, payload: {} };
    const fb = buildFactBase([{ id: fdwId, payload: {} }, aclFact], []);
    // No sub-fields provided → vacuously true for any fact with a `target` field
    expect(factMatches({ target: {} }, aclFact, fb)).toBe(true);
  });

  test("empty target predicate {} returns false for facts without target field", () => {
    const fact: Fact = { id: { kind: "schema", name: "public" }, payload: {} };
    const fb = buildFactBase([fact], []);
    expect(factMatches({ target: {} }, fact, fb)).toBe(false);
  });
});

describe("factMatches — edgeTo predicate", () => {
  test("matches when outgoing edge goes to fact with given kind", () => {
    const extId: StableId = { kind: "extension", name: "postgis" };
    const tableId: StableId = { kind: "table", schema: "public", name: "geo" };
    const schemaFact: Fact = {
      id: { kind: "schema", name: "public" },
      payload: {},
    };
    const extFact: Fact = { id: extId, payload: {} };
    const tableFact: Fact = {
      id: tableId,
      parent: { kind: "schema", name: "public" },
      payload: {},
    };
    const edge: DependencyEdge = {
      from: tableId,
      to: extId,
      kind: "memberOfExtension",
    };
    const fb = buildFactBase([schemaFact, extFact, tableFact], [edge]);
    expect(factMatches({ edgeTo: { kind: "extension" } }, tableFact, fb)).toBe(
      true,
    );
  });

  test("does not match when no outgoing edge exists", () => {
    const tableId: StableId = { kind: "table", schema: "public", name: "t" };
    const schemaFact: Fact = {
      id: { kind: "schema", name: "public" },
      payload: {},
    };
    const tableFact: Fact = {
      id: tableId,
      parent: { kind: "schema", name: "public" },
      payload: {},
    };
    const fb = buildFactBase([schemaFact, tableFact], []);
    expect(factMatches({ edgeTo: { kind: "extension" } }, tableFact, fb)).toBe(
      false,
    );
  });

  test("does not match when edge goes to different kind", () => {
    const roleId: StableId = { kind: "role", name: "owner" };
    const tableId: StableId = { kind: "table", schema: "public", name: "t" };
    const schemaFact: Fact = {
      id: { kind: "schema", name: "public" },
      payload: {},
    };
    const roleFact: Fact = { id: roleId, payload: {} };
    const tableFact: Fact = {
      id: tableId,
      parent: { kind: "schema", name: "public" },
      payload: {},
    };
    const edge: DependencyEdge = { from: tableId, to: roleId, kind: "owner" };
    const fb = buildFactBase([schemaFact, roleFact, tableFact], [edge]);
    expect(factMatches({ edgeTo: { kind: "extension" } }, tableFact, fb)).toBe(
      false,
    );
  });

  test("matches by schema of the target fact", () => {
    const procId: StableId = {
      kind: "function",
      schema: "public",
      name: "my_func",
      args: [],
    };
    const trigId: StableId = {
      kind: "trigger",
      schema: "auth",
      table: "users",
      name: "my_trigger",
    };
    const schemaAuthFact: Fact = {
      id: { kind: "schema", name: "auth" },
      payload: {},
    };
    const schemaPubFact: Fact = {
      id: { kind: "schema", name: "public" },
      payload: {},
    };
    const tableAuthFact: Fact = {
      id: { kind: "table", schema: "auth", name: "users" },
      parent: { kind: "schema", name: "auth" },
      payload: {},
    };
    const procFact: Fact = {
      id: procId,
      parent: { kind: "schema", name: "public" },
      payload: {},
    };
    const trigFact: Fact = {
      id: trigId,
      parent: { kind: "table", schema: "auth", name: "users" },
      payload: {},
    };
    const edge: DependencyEdge = { from: trigId, to: procId, kind: "depends" };
    const fb = buildFactBase(
      [schemaAuthFact, schemaPubFact, tableAuthFact, procFact, trigFact],
      [edge],
    );
    // trigger has an edge to a function in "public" (non-system schema)
    expect(
      factMatches(
        { edgeTo: { kind: "function", schema: "public" } },
        trigFact,
        fb,
      ),
    ).toBe(true);
    // does NOT match when we look for edge to function in "auth"
    expect(
      factMatches(
        { edgeTo: { kind: "function", schema: "auth" } },
        trigFact,
        fb,
      ),
    ).toBe(false);
  });

  test("edgeTo with only schema constraint (no kind filter)", () => {
    const procId: StableId = {
      kind: "function",
      schema: "public",
      name: "fn",
      args: [],
    };
    const trigId: StableId = {
      kind: "trigger",
      schema: "auth",
      table: "users",
      name: "tr",
    };
    const schemaAuthFact: Fact = {
      id: { kind: "schema", name: "auth" },
      payload: {},
    };
    const schemaPubFact: Fact = {
      id: { kind: "schema", name: "public" },
      payload: {},
    };
    const tableAuthFact: Fact = {
      id: { kind: "table", schema: "auth", name: "users" },
      parent: { kind: "schema", name: "auth" },
      payload: {},
    };
    const procFact: Fact = {
      id: procId,
      parent: { kind: "schema", name: "public" },
      payload: {},
    };
    const trigFact: Fact = {
      id: trigId,
      parent: { kind: "table", schema: "auth", name: "users" },
      payload: {},
    };
    const edge: DependencyEdge = { from: trigId, to: procId, kind: "depends" };
    const fb = buildFactBase(
      [schemaAuthFact, schemaPubFact, tableAuthFact, procFact, trigFact],
      [edge],
    );
    expect(factMatches({ edgeTo: { schema: "public" } }, trigFact, fb)).toBe(
      true,
    );
    expect(factMatches({ edgeTo: { schema: "auth" } }, trigFact, fb)).toBe(
      false,
    );
  });
});
