/**
 * Unit coverage for the default-ACL elision compaction pass (§3.6). Hand-built
 * actions + fact base so the per-grantee rules are exercised without a database.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import { type StableId } from "../core/stable-id.ts";
import { elideDefaultAclCreates } from "./internal.ts";
import type { Action } from "./plan.ts";

function mkAction(partial: Partial<Action> & { sql: string }): Action {
  return {
    verb: "create",
    produces: [],
    consumes: [],
    destroys: [],
    releases: [],
    transactionality: "transactional",
    lockClass: "none",
    newSegmentBefore: false,
    dataLoss: "none",
    rewriteRisk: false,
    ...partial,
  };
}

const typeId = (name: string): StableId => ({
  kind: "type",
  schema: "app",
  name,
});
const tableId = (name: string): StableId => ({
  kind: "table",
  schema: "app",
  name,
});
const aclId = (target: StableId, grantee: string): StableId => ({
  kind: "acl",
  target,
  grantee,
});

/** Build the REVOKE + GRANT action pair the emitter produces for one acl fact. */
function aclActions(target: StableId, grantee: string): Action[] {
  const id = aclId(target, grantee);
  return [
    mkAction({
      sql: `REVOKE ALL ... FROM ${grantee}`,
      produces: [id],
      consumes: [target],
    }),
    mkAction({
      sql: `GRANT ... TO ${grantee}`,
      produces: [],
      consumes: [id, target],
    }),
  ];
}

function aclFact(
  target: StableId,
  grantee: string,
  privileges: string[],
  grantable: string[] = [],
): Fact {
  return {
    id: aclId(target, grantee),
    parent: target,
    payload: { privileges, grantable },
  };
}

const roleFact = (name: string): Fact => ({
  id: { kind: "role", name },
  payload: {},
});

describe("elideDefaultAclCreates", () => {
  test("elides owner and default-PUBLIC grants on a co-created type", () => {
    const mood = typeId("mood");
    const facts: Fact[] = [
      { id: mood, payload: {} },
      roleFact("test"),
      aclFact(mood, "PUBLIC", ["USAGE"]),
      aclFact(mood, "test", ["USAGE"]),
    ];
    const edges: DependencyEdge[] = [
      { from: mood, to: { kind: "role", name: "test" }, kind: "owner" },
    ];
    const desired = buildFactBase(facts, edges);

    const actions: Action[] = [
      mkAction({ sql: "CREATE TYPE app.mood ...", produces: [mood] }),
      mkAction({
        sql: "ALTER TYPE app.mood OWNER TO test",
        verb: "alter",
        consumes: [mood, { kind: "role", name: "test" }],
      }),
      ...aclActions(mood, "PUBLIC"),
      ...aclActions(mood, "test"),
    ];

    const kept = elideDefaultAclCreates(actions, desired);
    expect(kept.map((a) => a.sql)).toEqual([
      "CREATE TYPE app.mood ...",
      "ALTER TYPE app.mood OWNER TO test",
    ]);
  });

  test("keeps a third-party grant on a co-created object", () => {
    const mood = typeId("mood");
    const facts: Fact[] = [
      { id: mood, payload: {} },
      roleFact("test"),
      roleFact("app_user"),
      aclFact(mood, "app_user", ["USAGE"]),
    ];
    const desired = buildFactBase(facts, [
      { from: mood, to: { kind: "role", name: "test" }, kind: "owner" },
    ]);
    const actions: Action[] = [
      mkAction({ sql: "CREATE TYPE app.mood ...", produces: [mood] }),
      ...aclActions(mood, "app_user"),
    ];
    const kept = elideDefaultAclCreates(actions, desired);
    expect(kept.map((a) => a.sql)).toContain("GRANT ... TO app_user");
    expect(kept).toHaveLength(3);
  });

  test("keeps a PUBLIC grant on a kind with no PUBLIC default (table)", () => {
    const t = tableId("t");
    const facts: Fact[] = [
      { id: t, payload: {} },
      roleFact("test"),
      aclFact(t, "PUBLIC", ["SELECT"]),
    ];
    const desired = buildFactBase(facts, [
      { from: t, to: { kind: "role", name: "test" }, kind: "owner" },
    ]);
    const actions: Action[] = [
      mkAction({ sql: "CREATE TABLE app.t ...", produces: [t] }),
      ...aclActions(t, "PUBLIC"),
    ];
    const kept = elideDefaultAclCreates(actions, desired);
    expect(kept.map((a) => a.sql)).toContain("GRANT ... TO PUBLIC");
  });

  test("keeps a non-default PUBLIC privilege set on a type (USAGE + something)", () => {
    const mood = typeId("mood");
    const facts: Fact[] = [
      { id: mood, payload: {} },
      roleFact("test"),
      // grant option present → not a default, keep it
      aclFact(mood, "PUBLIC", ["USAGE"], ["USAGE"]),
    ];
    const desired = buildFactBase(facts, [
      { from: mood, to: { kind: "role", name: "test" }, kind: "owner" },
    ]);
    const actions: Action[] = [
      mkAction({ sql: "CREATE TYPE app.mood ...", produces: [mood] }),
      ...aclActions(mood, "PUBLIC"),
    ];
    const kept = elideDefaultAclCreates(actions, desired);
    expect(kept.map((a) => a.sql)).toContain("GRANT ... TO PUBLIC");
  });

  test("leaves ACLs on a pre-existing object untouched", () => {
    const existing = typeId("existing");
    const facts: Fact[] = [
      { id: existing, payload: {} },
      roleFact("test"),
      aclFact(existing, "PUBLIC", ["USAGE"]),
    ];
    const desired = buildFactBase(facts, [
      { from: existing, to: { kind: "role", name: "test" }, kind: "owner" },
    ]);
    // no CREATE for `existing` → target not co-created
    const actions: Action[] = [...aclActions(existing, "PUBLIC")];
    const kept = elideDefaultAclCreates(actions, desired);
    expect(kept).toHaveLength(2);
  });

  test("no-op when there is nothing to elide", () => {
    const t = tableId("t");
    const desired = buildFactBase([{ id: t, payload: {} }], []);
    const actions: Action[] = [
      mkAction({ sql: "CREATE TABLE app.t ...", produces: [t] }),
    ];
    expect(elideDefaultAclCreates(actions, desired).map((a) => a.sql)).toEqual([
      "CREATE TABLE app.t ...",
    ]);
  });
});
