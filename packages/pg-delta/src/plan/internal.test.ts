/**
 * Unit coverage for the default-ACL elision compaction pass (§3.6). Hand-built
 * actions + fact base so the per-grantee rules are exercised without a database.
 */
import { describe, expect, test } from "bun:test";
import type { ApplierCapability } from "../policy/capability.ts";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import { type StableId } from "../core/stable-id.ts";
import {
  elideCoCreateRevokeBeforeGrant,
  elideDefaultAclCreates,
  foldCoCreateOwnership,
  mergeCoTargetGrants,
} from "./internal.ts";
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
const schemaId = (name: string): StableId => ({ kind: "schema", name });
const roleId = (name: string): StableId => ({ kind: "role", name });
const cap = (role: string): ApplierCapability => ({
  role,
  isSuperuser: false,
  memberOf: [role],
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
  ownerDefault?: string[],
): Fact {
  return {
    id: aclId(target, grantee),
    parent: target,
    payload: {
      privileges,
      grantable,
      ...(ownerDefault !== undefined ? { _ownerDefault: ownerDefault } : {}),
    },
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
      // owner has exactly the create-time default (USAGE for a type) → elidable
      aclFact(mood, "test", ["USAGE"], [], ["USAGE"]),
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

  test("keeps the owner ACL group when the owner revoked a create-time default", () => {
    // owner default for a table is the full set; here the owner kept everything
    // EXCEPT UPDATE. Eliding the REVOKE/GRANT group would leave PostgreSQL's full
    // create-time default in place, so UPDATE would wrongly come back (review P2).
    const t = tableId("t");
    const ownerDefault = [
      "DELETE",
      "INSERT",
      "REFERENCES",
      "SELECT",
      "TRIGGER",
      "TRUNCATE",
      "UPDATE",
    ];
    const desiredOwnerPrivs = ownerDefault.filter((p) => p !== "UPDATE");
    const facts: Fact[] = [
      { id: t, payload: {} },
      roleFact("test"),
      aclFact(t, "test", desiredOwnerPrivs, [], ownerDefault),
    ];
    const desired = buildFactBase(facts, [
      { from: t, to: { kind: "role", name: "test" }, kind: "owner" },
    ]);
    const actions: Action[] = [
      mkAction({ sql: "CREATE TABLE app.t ...", produces: [t] }),
      ...aclActions(t, "test"),
    ];
    const kept = elideDefaultAclCreates(actions, desired);
    expect(kept.map((a) => a.sql)).toContain("REVOKE ALL ... FROM test");
    expect(kept.map((a) => a.sql)).toContain("GRANT ... TO test");
  });

  test("keeps the owner ACL group when an ALTER DEFAULT PRIVILEGES customizes the objtype", () => {
    // desired owner == the built-in default, BUT an ADP reduces the owner default
    // for new tables. Since a from-empty plan does not guarantee the table is
    // created AFTER the ADP, the create-time owner ACL is ambiguous, so the
    // REVOKE/GRANT group is load-bearing and must NOT be elided (review P2).
    const t = tableId("t");
    const ownerDefault = [
      "DELETE",
      "INSERT",
      "REFERENCES",
      "SELECT",
      "TRIGGER",
      "TRUNCATE",
      "UPDATE",
    ];
    const adp: StableId = {
      kind: "defaultPrivilege",
      role: "test",
      schema: null,
      objtype: "r",
      grantee: "test",
    };
    const facts: Fact[] = [
      { id: t, payload: {} },
      roleFact("test"),
      aclFact(t, "test", ownerDefault, [], ownerDefault),
      {
        id: adp,
        payload: { privileges: ownerDefault.filter((p) => p !== "UPDATE") },
      },
    ];
    const desired = buildFactBase(facts, [
      { from: t, to: { kind: "role", name: "test" }, kind: "owner" },
    ]);
    const actions: Action[] = [
      mkAction({ sql: "CREATE TABLE app.t ...", produces: [t] }),
      ...aclActions(t, "test"),
    ];
    // capability's role is the ADP's defaclrole (the applier creates the object)
    const kept = elideDefaultAclCreates(actions, desired, cap("test"));
    expect(kept.map((a) => a.sql)).toContain("REVOKE ALL ... FROM test");
    expect(kept.map((a) => a.sql)).toContain("GRANT ... TO test");
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

describe("foldCoCreateOwnership", () => {
  test("folds a co-created schema + owner ALTER into CREATE SCHEMA AUTHORIZATION", () => {
    const s = schemaId("myschema");
    const desired = buildFactBase(
      [{ id: s, payload: {} }, roleFact("bob")],
      [{ from: s, to: roleId("bob"), kind: "owner" }],
    );
    const actions: Action[] = [
      mkAction({ sql: `CREATE SCHEMA "myschema"`, produces: [s] }),
      mkAction({
        sql: `ALTER SCHEMA "myschema" OWNER TO "bob"`,
        verb: "alter",
        consumes: [s, roleId("bob")],
      }),
    ];
    // schema fold is always-on (syntactic equivalence), even with no capability
    const kept = foldCoCreateOwnership(actions, desired);
    expect(kept.map((a) => a.sql)).toEqual([
      `CREATE SCHEMA "myschema" AUTHORIZATION "bob"`,
    ]);
  });

  test("does not fold a foreign-owner schema the restricted applier cannot set", () => {
    // a restricted applier (`test`, not a superuser, not a member of `bob`)
    // cannot run AUTHORIZATION bob NOR ALTER … OWNER TO bob. The fold's safety
    // invariant must be local: do not collapse an ALTER we cannot prove the
    // applier could execute (in the real pipeline emit's canSetOwner fail-fast
    // runs first; this keeps the fold self-contained if called without it).
    const s = schemaId("myschema");
    const desired = buildFactBase(
      [{ id: s, payload: {} }, roleFact("bob")],
      [{ from: s, to: roleId("bob"), kind: "owner" }],
    );
    const actions: Action[] = [
      mkAction({ sql: `CREATE SCHEMA "myschema"`, produces: [s] }),
      mkAction({
        sql: `ALTER SCHEMA "myschema" OWNER TO "bob"`,
        verb: "alter",
        consumes: [s, roleId("bob")],
      }),
    ];
    const kept = foldCoCreateOwnership(actions, desired, cap("test"));
    expect(kept.map((a) => a.sql)).toEqual([
      `CREATE SCHEMA "myschema"`,
      `ALTER SCHEMA "myschema" OWNER TO "bob"`,
    ]);
  });

  test("elides an applier-redundant owner ALTER on a co-created type", () => {
    const mood = typeId("mood");
    const desired = buildFactBase(
      [{ id: mood, payload: {} }, roleFact("test")],
      [{ from: mood, to: roleId("test"), kind: "owner" }],
    );
    const actions: Action[] = [
      mkAction({ sql: "CREATE TYPE app.mood ...", produces: [mood] }),
      mkAction({
        sql: "ALTER TYPE app.mood OWNER TO test",
        verb: "alter",
        consumes: [mood, roleId("test")],
      }),
    ];
    const kept = foldCoCreateOwnership(actions, desired, cap("test"));
    expect(kept.map((a) => a.sql)).toEqual(["CREATE TYPE app.mood ..."]);
  });

  test("keeps a foreign-owner ALTER on a co-created type", () => {
    const mood = typeId("mood");
    const desired = buildFactBase(
      [{ id: mood, payload: {} }, roleFact("type_owner")],
      [{ from: mood, to: roleId("type_owner"), kind: "owner" }],
    );
    const actions: Action[] = [
      mkAction({ sql: "CREATE TYPE app.mood ...", produces: [mood] }),
      mkAction({
        sql: "ALTER TYPE app.mood OWNER TO type_owner",
        verb: "alter",
        consumes: [mood, roleId("type_owner")],
      }),
    ];
    // applier is `test`, owner is `type_owner` → not a no-op, keep it
    const kept = foldCoCreateOwnership(actions, desired, cap("test"));
    expect(kept.map((a) => a.sql)).toEqual([
      "CREATE TYPE app.mood ...",
      "ALTER TYPE app.mood OWNER TO type_owner",
    ]);
  });

  test("leaves an owner change on a pre-existing object untouched", () => {
    const mood = typeId("mood");
    const fresh = typeId("fresh");
    const desired = buildFactBase(
      [{ id: mood, payload: {} }, { id: fresh, payload: {} }, roleFact("test")],
      [
        { from: mood, to: roleId("test"), kind: "owner" },
        { from: fresh, to: roleId("test"), kind: "owner" },
      ],
    );
    // a DIFFERENT object (`fresh`) is co-created so createActionOf is non-empty
    // — this exercises the genuine not-co-created branch for `mood`, not the
    // empty-map early return.
    const actions: Action[] = [
      mkAction({ sql: "CREATE TYPE app.fresh ...", produces: [fresh] }),
      // no CREATE for `mood` → target not co-created; this is a real owner change
      mkAction({
        sql: "ALTER TYPE app.mood OWNER TO test",
        verb: "alter",
        consumes: [mood, roleId("test")],
        releases: [roleId("old_owner")],
      }),
    ];
    const kept = foldCoCreateOwnership(actions, desired, cap("test"));
    expect(kept.map((a) => a.sql)).toEqual([
      "CREATE TYPE app.fresh ...",
      "ALTER TYPE app.mood OWNER TO test",
    ]);
  });

  test("without capability, a non-schema owner ALTER stays (Rule 2 inert)", () => {
    const mood = typeId("mood");
    const desired = buildFactBase(
      [{ id: mood, payload: {} }, roleFact("test")],
      [{ from: mood, to: roleId("test"), kind: "owner" }],
    );
    const actions: Action[] = [
      mkAction({ sql: "CREATE TYPE app.mood ...", produces: [mood] }),
      mkAction({
        sql: "ALTER TYPE app.mood OWNER TO test",
        verb: "alter",
        consumes: [mood, roleId("test")],
      }),
    ];
    const kept = foldCoCreateOwnership(actions, desired);
    expect(kept.map((a) => a.sql)).toEqual([
      "CREATE TYPE app.mood ...",
      "ALTER TYPE app.mood OWNER TO test",
    ]);
  });
});

/** Build a defaultPrivilege fact (ALTER DEFAULT PRIVILEGES residue). */
function defaultPrivilegeFact(
  role: string,
  schema: string | null,
  objtype: string,
  grantee: string,
  privileges: string[],
  grantable: string[] = [],
): Fact {
  return {
    id: { kind: "defaultPrivilege", role, schema, objtype, grantee },
    payload: { privileges, grantable },
  };
}

describe("elideCoCreateRevokeBeforeGrant", () => {
  test("drops the leading REVOKE for a third-party grant with no default", () => {
    const mood = typeId("mood");
    const desired = buildFactBase(
      [
        { id: mood, payload: {} },
        roleFact("app_user"),
        aclFact(mood, "app_user", ["USAGE"]),
      ],
      [],
    );
    const actions: Action[] = [
      mkAction({ sql: "CREATE TYPE app.mood ...", produces: [mood] }),
      ...aclActions(mood, "app_user"),
    ];
    const kept = elideCoCreateRevokeBeforeGrant(actions, desired);
    expect(kept.map((a) => a.sql)).toEqual([
      "CREATE TYPE app.mood ...",
      "GRANT ... TO app_user",
    ]);
  });

  test("keeps a REVOKE-only group (empty privileges)", () => {
    const mood = typeId("mood");
    const id = aclId(mood, "PUBLIC");
    const desired = buildFactBase(
      [{ id: mood, payload: {} }, aclFact(mood, "PUBLIC", [])],
      [],
    );
    const actions: Action[] = [
      mkAction({ sql: "CREATE TYPE app.mood ...", produces: [mood] }),
      mkAction({
        sql: "REVOKE ALL ... FROM PUBLIC",
        produces: [id],
        consumes: [mood],
      }),
    ];
    const kept = elideCoCreateRevokeBeforeGrant(actions, desired);
    expect(kept.map((a) => a.sql)).toContain("REVOKE ALL ... FROM PUBLIC");
  });

  test("keeps the REVOKE when a potentially-active default grants a superset", () => {
    const t = tableId("t");
    const desired = buildFactBase(
      [
        { id: t, payload: {} },
        roleFact("anon"),
        aclFact(t, "anon", ["SELECT"]),
        // applier `test` has a default privilege granting SELECT+INSERT on
        // tables in `app` to anon → REVOKE is load-bearing, keep it
        defaultPrivilegeFact("test", "app", "r", "anon", ["SELECT", "INSERT"]),
      ],
      [],
    );
    const actions: Action[] = [
      mkAction({ sql: "CREATE TABLE app.t ...", produces: [t] }),
      ...aclActions(t, "anon"),
    ];
    const kept = elideCoCreateRevokeBeforeGrant(actions, desired, cap("test"));
    expect(kept.map((a) => a.sql)).toContain("REVOKE ALL ... FROM anon");
  });

  test("keeps the REVOKE when a potentially-active default grants a grant option", () => {
    const t = tableId("t");
    const desired = buildFactBase(
      [
        { id: t, payload: {} },
        roleFact("anon"),
        aclFact(t, "anon", ["SELECT"]),
        // default grants SELECT WITH GRANT OPTION → plain GRANT would leave the
        // grant option behind without the REVOKE
        defaultPrivilegeFact("test", null, "r", "anon", ["SELECT"], ["SELECT"]),
      ],
      [],
    );
    const actions: Action[] = [
      mkAction({ sql: "CREATE TABLE app.t ...", produces: [t] }),
      ...aclActions(t, "anon"),
    ];
    const kept = elideCoCreateRevokeBeforeGrant(actions, desired, cap("test"));
    expect(kept.map((a) => a.sql)).toContain("REVOKE ALL ... FROM anon");
  });

  test("drops the REVOKE when the only default's privileges are a subset", () => {
    const t = tableId("t");
    const desired = buildFactBase(
      [
        { id: t, payload: {} },
        roleFact("anon"),
        aclFact(t, "anon", ["SELECT", "INSERT"]),
        // default grants only SELECT (subset of explicit) and no grant option →
        // the plain GRANT covers it, REVOKE is redundant
        defaultPrivilegeFact("test", "app", "r", "anon", ["SELECT"]),
      ],
      [],
    );
    const actions: Action[] = [
      mkAction({ sql: "CREATE TABLE app.t ...", produces: [t] }),
      ...aclActions(t, "anon"),
    ];
    const kept = elideCoCreateRevokeBeforeGrant(actions, desired, cap("test"));
    expect(kept.map((a) => a.sql)).not.toContain("REVOKE ALL ... FROM anon");
    expect(kept.map((a) => a.sql)).toContain("GRANT ... TO anon");
  });

  test("leaves ACLs on a pre-existing object untouched", () => {
    const existing = typeId("existing");
    const desired = buildFactBase(
      [
        { id: existing, payload: {} },
        roleFact("app_user"),
        aclFact(existing, "app_user", ["USAGE"]),
      ],
      [],
    );
    // no CREATE for `existing` → not co-created
    const actions: Action[] = [...aclActions(existing, "app_user")];
    const kept = elideCoCreateRevokeBeforeGrant(actions, desired);
    expect(kept).toHaveLength(2);
  });
});

describe("mergeCoTargetGrants", () => {
  const t = tableId("t");
  // the canonical single-grantee render the pass recognizes (renderGrantSql)
  const grantSql = (grantee: string) =>
    `GRANT SELECT ON TABLE "app"."t" TO "${grantee}"`;
  const grantAction = (grantee: string): Action =>
    mkAction({
      sql: grantSql(grantee),
      produces: [],
      consumes: [aclId(t, grantee), t, roleId(grantee)],
    });
  const desiredWith = (...grantees: string[]) =>
    buildFactBase(
      [
        { id: t, payload: {} },
        ...grantees.map((g) => roleFact(g)),
        ...grantees.map((g) => aclFact(t, g, ["SELECT"])),
      ],
      [],
    );

  test("merges a consecutive same-privilege run and strips dangling acl ids", () => {
    const desired = desiredWith("anon", "authenticated");
    const merged = mergeCoTargetGrants(
      [grantAction("anon"), grantAction("authenticated")],
      desired,
    );
    expect(merged.map((a) => a.sql)).toEqual([
      `GRANT SELECT ON TABLE "app"."t" TO "anon", "authenticated"`,
    ]);
    const consumes = merged[0]!.consumes;
    expect(consumes.some((c) => c.kind === "acl")).toBe(false);
    for (const g of ["anon", "authenticated"]) {
      expect(
        consumes.some((c) => c.kind === "role" && "name" in c && c.name === g),
      ).toBe(true);
    }
  });

  test("a newSegmentBefore boundary on a later member breaks the run", () => {
    const desired = desiredWith("anon", "authenticated");
    const second = grantAction("authenticated");
    second.newSegmentBefore = true;
    const merged = mergeCoTargetGrants([grantAction("anon"), second], desired);
    expect(merged.map((a) => a.sql)).toEqual([
      grantSql("anon"),
      grantSql("authenticated"),
    ]);
  });

  test("a non-grant action between members breaks the run (no reordering)", () => {
    const desired = desiredWith("anon", "authenticated");
    const between = mkAction({
      sql: "ALTER TABLE app.t ENABLE ROW LEVEL SECURITY",
      verb: "alter",
      consumes: [t],
    });
    const merged = mergeCoTargetGrants(
      [grantAction("anon"), between, grantAction("authenticated")],
      desired,
    );
    expect(merged.map((a) => a.sql)).toEqual([
      grantSql("anon"),
      "ALTER TABLE app.t ENABLE ROW LEVEL SECURITY",
      grantSql("authenticated"),
    ]);
  });

  test("a group whose REVOKE leader survives stays intact", () => {
    const desired = desiredWith("anon", "authenticated");
    // pre-existing target shape: the REVOKE producing anon's acl id survives,
    // so anon's GRANT is excluded from merging (pg_dump pairing kept).
    const revoke = mkAction({
      sql: `REVOKE ALL ON TABLE "app"."t" FROM "anon"`,
      produces: [aclId(t, "anon")],
      consumes: [t],
    });
    const merged = mergeCoTargetGrants(
      [revoke, grantAction("anon"), grantAction("authenticated")],
      desired,
    );
    expect(merged.map((a) => a.sql)).toEqual([
      `REVOKE ALL ON TABLE "app"."t" FROM "anon"`,
      grantSql("anon"),
      grantSql("authenticated"),
    ]);
  });

  test("the run-leading segment boundary is preserved on the merged action", () => {
    const desired = desiredWith("anon", "authenticated");
    const firstAction = grantAction("anon");
    firstAction.newSegmentBefore = true;
    const merged = mergeCoTargetGrants(
      [firstAction, grantAction("authenticated")],
      desired,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.newSegmentBefore).toBe(true);
  });
});
