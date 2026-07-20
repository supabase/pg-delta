/**
 * Unit tests for the role-rename carry Module (third follow-up review P2).
 * Pure functions — no Docker / database required.
 */
import { describe, expect, test } from "bun:test";
import type { Delta } from "../core/diff.ts";
import { buildFactBase, type Fact } from "../core/fact.ts";
import {
  ALL_FACT_KINDS,
  encodeId,
  type FactKind,
  type StableId,
} from "../core/stable-id.ts";
import {
  buildRoleRenameMap,
  computeRoleRenameCarry,
  ownerEdgeKey,
  relabelRoleNames,
  ROLE_NAME_BEARING_KINDS,
  roleNamesIn,
} from "./role-rename-carry.ts";
import { plan } from "./plan.ts";

const rename = new Map([["r1", "r2"]]);

const rolePayload = () => ({
  superuser: false,
  inherit: true,
  createRole: false,
  createDb: false,
  login: false,
  replication: false,
  bypassRls: false,
  config: ["statement_timeout=42424ms"],
});

const schema: StableId = { kind: "schema", name: "app" };
const table: StableId = { kind: "table", schema: "app", name: "docs" };
const policy: StableId = {
  kind: "policy",
  schema: "app",
  table: "docs",
  name: "docs_read",
};

const policyFact = (role: string): Fact => ({
  id: policy,
  parent: table,
  payload: {
    cmd: "r",
    permissive: true,
    roles: [role],
    usingExpr: "true",
    checkExpr: null,
  },
});

const rolePolicyBase = (role: string, includeRole = true) =>
  buildFactBase(
    [
      ...(includeRole
        ? [
            {
              id: { kind: "role", name: role } as StableId,
              payload: rolePayload(),
            },
          ]
        : []),
      { id: schema, payload: {} },
      { id: table, parent: schema, payload: { persistence: "p" } },
      policyFact(role),
    ],
    [],
  );

describe("accepted role rename + policy role payload (B1)", () => {
  test("orders the rename before ALTER POLICY without a dependency cycle", () => {
    let thePlan!: ReturnType<typeof plan>;
    expect(() => {
      thePlan = plan(rolePolicyBase("role_a"), rolePolicyBase("role_b"), {
        renames: "auto",
        compact: false,
      });
    }).not.toThrow();

    expect(thePlan.actions.map((action) => action.sql)).toMatchInlineSnapshot(`
      [
        "ALTER ROLE \"role_a\" RENAME TO \"role_b\"",
        "ALTER POLICY \"docs_read\" ON \"app\".\"docs\" TO \"role_b\"",
      ]
    `);
  });

  test("still releases a genuinely dropped role before DROP ROLE", () => {
    const source = rolePolicyBase("role_a");
    const desired = rolePolicyBase("PUBLIC", false);
    const thePlan = plan(source, desired, {
      renames: "auto",
      compact: false,
    });

    const alterPolicy = thePlan.actions.findIndex((action) =>
      action.sql.startsWith('ALTER POLICY "docs_read"'),
    );
    const dropRole = thePlan.actions.findIndex((action) =>
      action.sql.includes('DROP ROLE "role_a"'),
    );
    expect(alterPolicy).toBeGreaterThanOrEqual(0);
    expect(dropRole).toBeGreaterThanOrEqual(0);
    expect(alterPolicy).toBeLessThan(dropRole);
  });
});

describe("relabelRoleNames", () => {
  test("remaps a bare role id", () => {
    expect(relabelRoleNames({ kind: "role", name: "r1" }, rename)).toEqual({
      kind: "role",
      name: "r2",
    });
  });

  test("remaps acl grantee, leaves the object target", () => {
    const id: StableId = {
      kind: "acl",
      target: { kind: "table", schema: "app", name: "t" },
      grantee: "r1",
    };
    expect(relabelRoleNames(id, rename)).toEqual({
      kind: "acl",
      target: { kind: "table", schema: "app", name: "t" },
      grantee: "r2",
    });
  });

  test("preserves the column field of a COLUMN-level acl", () => {
    // regression: a COLUMN-level grant's `column` field must survive relabeling
    // (only the grantee/role changes). Dropping it makes the relabeled key miss
    // its desired counterpart, so a pure role rename spuriously REVOKE/GRANTs
    // the column grant instead of letting PostgreSQL carry it by OID.
    const id: StableId = {
      kind: "acl",
      target: { kind: "table", schema: "app", name: "t" },
      grantee: "r1",
      column: "col1",
    };
    expect(relabelRoleNames(id, rename)).toEqual({
      kind: "acl",
      target: { kind: "table", schema: "app", name: "t" },
      grantee: "r2",
      column: "col1",
    });
  });

  test("remaps both ends of a membership", () => {
    const id: StableId = { kind: "membership", role: "r1", member: "r1" };
    expect(relabelRoleNames(id, rename)).toEqual({
      kind: "membership",
      role: "r2",
      member: "r2",
    });
  });

  test("remaps defaultPrivilege role + grantee, keeps schema/objtype", () => {
    const id: StableId = {
      kind: "defaultPrivilege",
      role: "r1",
      schema: "app",
      objtype: "r",
      grantee: "r1",
    };
    expect(relabelRoleNames(id, rename)).toEqual({
      kind: "defaultPrivilege",
      role: "r2",
      schema: "app",
      objtype: "r",
      grantee: "r2",
    });
  });

  test("remaps userMapping role, keeps server", () => {
    const id: StableId = { kind: "userMapping", server: "srv", role: "r1" };
    expect(relabelRoleNames(id, rename)).toEqual({
      kind: "userMapping",
      server: "srv",
      role: "r2",
    });
  });

  test("recurses into a comment ON a role", () => {
    const id: StableId = {
      kind: "comment",
      target: { kind: "role", name: "r1" },
    };
    expect(relabelRoleNames(id, rename)).toEqual({
      kind: "comment",
      target: { kind: "role", name: "r2" },
    });
  });

  test("leaves an id that references no renamed role unchanged", () => {
    const id: StableId = { kind: "table", schema: "app", name: "t" };
    expect(encodeId(relabelRoleNames(id, rename))).toBe(encodeId(id));
    const dpOther: StableId = {
      kind: "defaultPrivilege",
      role: "other",
      schema: "app",
      objtype: "r",
      grantee: "PUBLIC",
    };
    expect(encodeId(relabelRoleNames(dpOther, rename))).toBe(encodeId(dpOther));
  });
});

describe("buildRoleRenameMap", () => {
  test("collects role↔role renames only", () => {
    const map = buildRoleRenameMap([
      {
        from: { id: { kind: "role", name: "r1" }, payload: {} },
        to: { id: { kind: "role", name: "r2" }, payload: {} },
      },
      {
        from: {
          id: { kind: "table", schema: "app", name: "old" },
          payload: {},
        },
        to: { id: { kind: "table", schema: "app", name: "new" }, payload: {} },
      },
    ]);
    expect([...map]).toEqual([["r1", "r2"]]);
  });
});

describe("computeRoleRenameCarry", () => {
  const dp = (role: string): StableId => ({
    kind: "defaultPrivilege",
    role,
    schema: "app",
    objtype: "r",
    grantee: "PUBLIC",
  });
  const table: StableId = { kind: "table", schema: "app", name: "t" };

  test("carries an identical default-privilege remove/add pair", () => {
    const deltas: Delta[] = [
      {
        verb: "remove",
        fact: {
          id: dp("r1"),
          payload: { privileges: ["SELECT"], grantable: [] },
        },
      },
      {
        verb: "add",
        fact: {
          id: dp("r2"),
          payload: { privileges: ["SELECT"], grantable: [] },
        },
      },
    ];
    const { carriedFactKeys } = computeRoleRenameCarry(deltas, rename);
    expect(carriedFactKeys.has(encodeId(dp("r1")))).toBe(true);
    expect(carriedFactKeys.has(encodeId(dp("r2")))).toBe(true);
  });

  test("carries an identical COLUMN-level acl remove/add pair", () => {
    // regression: the carry must recognise a column-qualified grant across a
    // pure role rename (identity differs only by grantee), preserving `column`.
    const colAcl = (grantee: string): StableId => ({
      kind: "acl",
      target: table,
      grantee,
      column: "col1",
    });
    const deltas: Delta[] = [
      {
        verb: "remove",
        fact: {
          id: colAcl("r1"),
          payload: { privileges: ["SELECT"], grantable: [] },
        },
      },
      {
        verb: "add",
        fact: {
          id: colAcl("r2"),
          payload: { privileges: ["SELECT"], grantable: [] },
        },
      },
    ];
    const { carriedFactKeys } = computeRoleRenameCarry(deltas, rename);
    expect(carriedFactKeys.has(encodeId(colAcl("r1")))).toBe(true);
    expect(carriedFactKeys.has(encodeId(colAcl("r2")))).toBe(true);
  });

  test("does NOT carry a pair whose payload also changed", () => {
    const deltas: Delta[] = [
      {
        verb: "remove",
        fact: {
          id: dp("r1"),
          payload: { privileges: ["SELECT"], grantable: [] },
        },
      },
      {
        verb: "add",
        fact: {
          id: dp("r2"),
          payload: { privileges: ["INSERT"], grantable: [] },
        },
      },
    ];
    const { carriedFactKeys } = computeRoleRenameCarry(deltas, rename);
    expect(carriedFactKeys.size).toBe(0);
  });

  test("carries an owner unlink/link pair on a stable object", () => {
    const deltas: Delta[] = [
      {
        verb: "unlink",
        edge: { from: table, to: { kind: "role", name: "r1" }, kind: "owner" },
      },
      {
        verb: "link",
        edge: { from: table, to: { kind: "role", name: "r2" }, kind: "owner" },
      },
    ];
    const { carriedOwnerLinks } = computeRoleRenameCarry(deltas, rename);
    expect(
      carriedOwnerLinks.has(ownerEdgeKey(table, { kind: "role", name: "r2" })),
    ).toBe(true);
  });

  test("does NOT carry an owner change to a non-renamed role", () => {
    const deltas: Delta[] = [
      {
        verb: "unlink",
        edge: { from: table, to: { kind: "role", name: "r1" }, kind: "owner" },
      },
      {
        verb: "link",
        edge: { from: table, to: { kind: "role", name: "r3" }, kind: "owner" },
      },
    ];
    const { carriedOwnerLinks } = computeRoleRenameCarry(deltas, rename);
    expect(carriedOwnerLinks.size).toBe(0);
  });

  test("empty rename map carries nothing", () => {
    const deltas: Delta[] = [
      { verb: "remove", fact: { id: dp("r1"), payload: {} } },
      { verb: "add", fact: { id: dp("r2"), payload: {} } },
    ];
    const { carriedFactKeys, carriedOwnerLinks } = computeRoleRenameCarry(
      deltas,
      new Map(),
    );
    expect(carriedFactKeys.size).toBe(0);
    expect(carriedOwnerLinks.size).toBe(0);
  });

  test("a changed payload becomes a changedFacts pair, not a carried key", () => {
    const deltas: Delta[] = [
      {
        verb: "remove",
        fact: {
          id: dp("r1"),
          payload: { privileges: ["SELECT"], grantable: [] },
        },
      },
      {
        verb: "add",
        fact: {
          id: dp("r2"),
          payload: { privileges: ["INSERT"], grantable: [] },
        },
      },
    ];
    const { carriedFactKeys, changedFacts } = computeRoleRenameCarry(
      deltas,
      rename,
    );
    expect(carriedFactKeys.size).toBe(0);
    expect(changedFacts).toHaveLength(1);
    expect(encodeId(changedFacts[0]!.from)).toBe(encodeId(dp("r1")));
    expect(encodeId(changedFacts[0]!.to)).toBe(encodeId(dp("r2")));
  });

  test("a remove with no relabeled counterpart is neither carried nor changed", () => {
    const deltas: Delta[] = [
      { verb: "remove", fact: { id: dp("r1"), payload: {} } },
    ];
    const { carriedFactKeys, changedFacts } = computeRoleRenameCarry(
      deltas,
      rename,
    );
    expect(carriedFactKeys.size).toBe(0);
    expect(changedFacts).toHaveLength(0);
  });
});

describe("roleNamesIn", () => {
  test("collects role names across kinds (recursing into targets)", () => {
    expect(
      [...roleNamesIn({ kind: "membership", role: "g", member: "m" })].sort(),
    ).toEqual(["g", "m"]);
    expect(
      [
        ...roleNamesIn({
          kind: "defaultPrivilege",
          role: "owner",
          schema: "app",
          objtype: "r",
          grantee: "PUBLIC",
        }),
      ].sort(),
    ).toEqual(["PUBLIC", "owner"]);
    expect([
      ...roleNamesIn({
        kind: "comment",
        target: { kind: "role", name: "r1" },
      }),
    ]).toEqual(["r1"]);
    // an object id embeds no role name
    expect([
      ...roleNamesIn({ kind: "table", schema: "app", name: "t" }),
    ]).toEqual([]);
  });
});

describe("role-name-bearing kind registry (review P3 guard)", () => {
  // every StableId kind must be classified as role-name-bearing or not; a NEW
  // kind added to ALL_FACT_KINDS lands here and fails until it is triaged.
  const NON_ROLE_BEARING: ReadonlySet<FactKind> = new Set([
    "schema",
    "extension",
    "language",
    "eventTrigger",
    "publication",
    "subscription",
    "fdw",
    "server",
    "table",
    "view",
    "materializedView",
    "foreignTable",
    "sequence",
    "index",
    "collation",
    "domain",
    "type",
    "column",
    "constraint",
    "trigger",
    "rule",
    "policy",
    "default",
    "function",
    "procedure",
    "aggregate",
    "typeAttribute",
    "publicationRel",
    "publicationSchema",
    // extension intent ids carry ext/intentKind/key only; any role reference
    // (e.g. a cron job's `username`) lives in the payload, not the id, so no
    // role name is relabeled — same honest blind spot as function bodies.
    "extensionIntent",
  ]);

  test("ROLE_NAME_BEARING_KINDS and NON_ROLE_BEARING partition ALL_FACT_KINDS", () => {
    for (const kind of ALL_FACT_KINDS) {
      const bearing = ROLE_NAME_BEARING_KINDS.has(kind);
      const nonBearing = NON_ROLE_BEARING.has(kind);
      // exactly one of the two sets must claim the kind
      expect(bearing !== nonBearing).toBe(true);
    }
    expect(ROLE_NAME_BEARING_KINDS.size + NON_ROLE_BEARING.size).toBe(
      ALL_FACT_KINDS.length,
    );
  });

  test("relabelRoleNames actually transforms every role-name-bearing kind", () => {
    // each bearing kind, given an id that references the renamed role, must come
    // back CHANGED — i.e. it is handled in the switch, not the default branch
    const samples: Record<string, StableId> = {
      role: { kind: "role", name: "r1" },
      membership: { kind: "membership", role: "r1", member: "x" },
      userMapping: { kind: "userMapping", server: "s", role: "r1" },
      defaultPrivilege: {
        kind: "defaultPrivilege",
        role: "r1",
        schema: null,
        objtype: "r",
        grantee: "PUBLIC",
      },
      acl: {
        kind: "acl",
        target: { kind: "table", schema: "a", name: "t" },
        grantee: "r1",
      },
      comment: { kind: "comment", target: { kind: "role", name: "r1" } },
      securityLabel: {
        kind: "securityLabel",
        target: { kind: "role", name: "r1" },
        provider: "p",
      },
    };
    for (const kind of ROLE_NAME_BEARING_KINDS) {
      const sample = samples[kind];
      expect(sample, `missing sample for ${kind}`).toBeDefined();
      expect(encodeId(relabelRoleNames(sample!, rename))).not.toBe(
        encodeId(sample!),
      );
    }
  });
});
