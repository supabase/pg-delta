import { describe, expect, test } from "bun:test";
import { diff } from "../core/diff.ts";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
  type FactBase,
} from "../core/fact.ts";
import {
  ALL_FACT_KINDS,
  encodeId,
  type FactKind,
  type StableId,
} from "../core/stable-id.ts";
import {
  buildRoleRenameMap,
  normalizeRoleIdentities,
  relabelRoleNames,
  ROLE_NAME_BEARING_KINDS,
} from "./identity-normalize.ts";

const rename = new Map([["role_old", "role_new"]]);
const schema: StableId = { kind: "schema", name: "app" };
const table: StableId = { kind: "table", schema: "app", name: "docs" };
const server: StableId = { kind: "server", name: "foreign_server" };
const policy: StableId = {
  kind: "policy",
  schema: "app",
  table: "docs",
  name: "read_docs",
};

function role(name: string): StableId {
  return { kind: "role", name };
}

function roleFacts(name: string, policyRoles: string[]): Fact[] {
  const roleId = role(name);
  return [
    { id: roleId, payload: { login: true } },
    { id: schema, payload: {} },
    { id: table, parent: schema, payload: { persistence: "p" } },
    { id: server, payload: { type: "postgres_fdw" } },
    {
      id: { kind: "membership", role: name, member: name },
      payload: { adminOption: false },
    },
    {
      id: { kind: "userMapping", server: "foreign_server", role: name },
      parent: server,
      payload: { options: ["user=remote"] },
    },
    {
      id: {
        kind: "defaultPrivilege",
        role: name,
        schema: "app",
        objtype: "r",
        grantee: name,
      },
      parent: schema,
      payload: { privileges: ["SELECT"], grantable: [] },
    },
    {
      id: { kind: "acl", target: table, grantee: name, column: "body" },
      parent: table,
      payload: { privileges: ["SELECT"], grantable: [] },
    },
    {
      id: { kind: "comment", target: roleId },
      parent: roleId,
      payload: { text: "reader" },
    },
    {
      id: { kind: "securityLabel", target: roleId, provider: "dummy" },
      parent: roleId,
      payload: { label: "trusted" },
    },
    {
      id: policy,
      parent: table,
      payload: {
        cmd: "r",
        permissive: true,
        roles: policyRoles,
        usingExpr: "true",
        checkExpr: null,
      },
    },
  ];
}

function roleBase(
  name: string,
  policyRoles: string[],
  opts: { source?: "liveDb" | "sqlFiles" | "snapshot" } = {},
): FactBase {
  const edges: DependencyEdge[] = [
    { from: table, to: role(name), kind: "owner" },
    {
      from: { kind: "membership", role: name, member: name },
      to: role(name),
      kind: "depends",
    },
  ];
  return buildFactBase(roleFacts(name, policyRoles), edges, opts.source);
}

describe("normalizeRoleIdentities", () => {
  test("canonical diff removes pure role-name relabel churn", () => {
    const source = roleBase("role_old", ["z_role", "role_old"]);
    const desired = roleBase("role_new", ["role_new", "z_role"]);

    const canonicalSource = normalizeRoleIdentities(source, rename);
    const canonicalDesired = normalizeRoleIdentities(desired, rename);

    expect(diff(canonicalSource, canonicalDesired)).toEqual([]);
    expect(canonicalSource.rootHash).not.toBe(source.rootHash);
    expect(canonicalSource.rootHash).toBe(canonicalDesired.rootHash);
    expect(
      canonicalSource.get({
        kind: "acl",
        target: table,
        grantee: "role_new",
        column: "body",
      })?.id,
    ).toEqual({
      kind: "acl",
      target: table,
      grantee: "role_new",
      column: "body",
    });
    expect(canonicalSource.get(policy)?.payload.roles).toEqual([
      "role_new",
      "z_role",
    ]);
    expect(canonicalSource.outgoingEdges(table)).toContainEqual({
      from: table,
      to: role("role_new"),
      kind: "owner",
    });
  });

  test("a payload change becomes a set on the canonical id", () => {
    const oldId: StableId = {
      kind: "defaultPrivilege",
      role: "role_old",
      schema: "app",
      objtype: "r",
      grantee: "role_old",
    };
    const newId = relabelRoleNames(oldId, rename);
    const source = buildFactBase(
      [
        { id: schema, payload: {} },
        {
          id: oldId,
          parent: schema,
          payload: { privileges: ["SELECT"], grantable: [] },
        },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        { id: schema, payload: {} },
        {
          id: newId,
          parent: schema,
          payload: { privileges: ["INSERT"], grantable: [] },
        },
      ],
      [],
    );

    expect(
      diff(
        normalizeRoleIdentities(source, rename),
        normalizeRoleIdentities(desired, rename),
      ),
    ).toEqual([
      {
        verb: "set",
        id: newId,
        attr: "privileges",
        from: ["SELECT"],
        to: ["INSERT"],
      },
    ]);
  });

  test("is copy-on-write and preserves provenance and diagnostics", () => {
    const source = roleBase("role_old", ["role_old"], {
      source: "snapshot",
    });
    source.diagnostics.push({
      code: "fixture",
      severity: "warning",
      subject: role("role_old"),
      message: "preserve me verbatim",
    });
    const originalFacts = structuredClone(source.facts());
    const originalEdges = structuredClone(source.edges);

    const normalized = normalizeRoleIdentities(source, rename);

    expect(normalized).not.toBe(source);
    expect(source.facts()).toEqual(originalFacts);
    expect(source.edges).toEqual(originalEdges);
    expect(source.get(policy)?.payload.roles).toEqual(["role_old"]);
    expect(normalized.source).toBe("snapshot");
    expect(normalized.diagnostics).toEqual(source.diagnostics);
  });

  test("remaps encoded referenceOnly entries", () => {
    const oldRole = role("role_old");
    const base = buildFactBase(
      [{ id: oldRole, payload: {} }],
      [],
      "liveDb",
      new Set([encodeId(oldRole)]),
    );

    const normalized = normalizeRoleIdentities(base, rename);

    expect(normalized.referenceOnly).toEqual(
      new Set([encodeId(role("role_new"))]),
    );
    expect(normalized.isReferenceOnly(role("role_new"))).toBe(true);
  });

  test("remaps parents and both edge endpoints", () => {
    const oldRole = role("role_old");
    const comment: StableId = { kind: "comment", target: oldRole };
    const base = buildFactBase(
      [
        { id: oldRole, payload: {} },
        { id: comment, parent: oldRole, payload: { text: "x" } },
      ],
      [{ from: comment, to: oldRole, kind: "depends" }],
    );

    const normalized = normalizeRoleIdentities(base, rename);
    const newRole = role("role_new");
    const newComment: StableId = { kind: "comment", target: newRole };

    expect(normalized.get(newComment)?.parent).toEqual(newRole);
    expect(normalized.edges).toEqual([
      { from: newComment, to: newRole, kind: "depends" },
    ]);
  });

  test("retains dangling owner edges to remapped roles", () => {
    const base = buildFactBase(
      [
        { id: schema, payload: {} },
        { id: table, parent: schema, payload: {} },
      ],
      [{ from: table, to: role("role_old"), kind: "owner" }],
      "liveDb",
      new Set(),
      { allowDangling: (edge) => edge.kind === "owner" },
    );

    const normalized = normalizeRoleIdentities(base, rename);

    expect(normalized.edges).toEqual([
      { from: table, to: role("role_new"), kind: "owner" },
    ]);
    expect(normalized.diagnostics).toEqual([]);
  });

  test("does not rewrite unrelated payload strings", () => {
    const base = buildFactBase(
      [
        {
          id: {
            kind: "extensionIntent",
            ext: "pg_cron",
            intentKind: "job",
            key: "daily",
          },
          payload: { username: "role_old", command: "select 'role_old'" },
        },
      ],
      [],
    );

    const normalized = normalizeRoleIdentities(base, rename);
    expect(normalized.facts()[0]?.payload).toEqual({
      username: "role_old",
      command: "select 'role_old'",
    });
  });

  test("returns the original base for an empty map", () => {
    const base = roleBase("role_old", ["role_old"]);
    expect(normalizeRoleIdentities(base, new Map())).toBe(base);
  });
});

describe("role-name-bearing kind registry", () => {
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
    "extensionIntent",
  ]);

  test("bearing and non-bearing sets exhaustively partition all kinds", () => {
    for (const kind of ALL_FACT_KINDS) {
      expect(
        ROLE_NAME_BEARING_KINDS.has(kind) !== NON_ROLE_BEARING.has(kind),
      ).toBe(true);
    }
    expect(ROLE_NAME_BEARING_KINDS.size + NON_ROLE_BEARING.size).toBe(
      ALL_FACT_KINDS.length,
    );
  });

  test("every bearing kind is actually relabeled", () => {
    const samples: Record<string, StableId> = {
      role: role("role_old"),
      membership: {
        kind: "membership",
        role: "role_old",
        member: "other",
      },
      userMapping: {
        kind: "userMapping",
        server: "server",
        role: "role_old",
      },
      defaultPrivilege: {
        kind: "defaultPrivilege",
        role: "role_old",
        schema: null,
        objtype: "r",
        grantee: "PUBLIC",
      },
      acl: { kind: "acl", target: table, grantee: "role_old" },
      comment: { kind: "comment", target: role("role_old") },
      securityLabel: {
        kind: "securityLabel",
        target: role("role_old"),
        provider: "dummy",
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

  test("builds a map from role-to-role accepted renames only", () => {
    expect([
      ...buildRoleRenameMap([
        {
          from: { id: role("role_old"), payload: {} },
          to: { id: role("role_new"), payload: {} },
        },
        {
          from: {
            id: { kind: "table", schema: "app", name: "before" },
            payload: {},
          },
          to: {
            id: { kind: "table", schema: "app", name: "after" },
            payload: {},
          },
        },
      ]),
    ]).toEqual([["role_old", "role_new"]]);
  });
});
