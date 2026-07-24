/**
 * Unit regressions for accepted-rename ownership modeling (second follow-up
 * review 2026-06-15, P1 #1 + #2). No Docker / database required.
 *
 * `ALTER … RENAME` changes IDENTITY, not OWNER: PostgreSQL preserves the owner
 * OID across a rename, and any genuine owner change is a separate owner action.
 * Two consequences the planner must honor:
 *
 *  1. owner CHANGE under a rename — the owner-link action must `releases` the
 *     OLD owner so the old role's drop sorts AFTER the reassignment, not before
 *     (else `DROP OWNED BY old; DROP ROLE old` drops the still-old-owned table).
 *  2. owner CARRIED through a role rename — when a table and its owner role are
 *     BOTH renamed, the owner is already correct after the two renames, so NO
 *     `ALTER … OWNER TO` is emitted and the rename actions must not form a cycle.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const rolePayload = (login = false) => ({
  superuser: false,
  inherit: true,
  createRole: false,
  createDb: false,
  login,
  replication: false,
  bypassRls: false,
  config: [],
});

const tablePayload = () => ({
  persistence: "p",
  rowSecurity: false,
  forceRowSecurity: false,
  replicaIdentity: "d",
  replicaIdentityIndex: null,
  partitionKey: null,
  partitionBound: null,
  parentTable: null,
});

const role1: StableId = { kind: "role", name: "r1" };
const role2: StableId = { kind: "role", name: "r2" };
const schema: StableId = { kind: "schema", name: "app" };
const oldTable: StableId = { kind: "table", schema: "app", name: "old_t" };
const newTable: StableId = { kind: "table", schema: "app", name: "new_t" };

describe("accepted rename + owner change (review P1 #1)", () => {
  test("ALTER … OWNER TO releases the old owner and sorts before its DROP", () => {
    // source: r1 owns app.old_t
    const source = buildFactBase(
      [
        { id: role1, payload: rolePayload(false) },
        { id: schema, payload: {} },
        { id: oldTable, parent: schema, payload: tablePayload() },
      ],
      [{ from: oldTable, to: role1, kind: "owner" }],
    );
    // desired: app.new_t (accepted rename of old_t) owned by a NEW role r2; r1 gone
    const desired = buildFactBase(
      [
        { id: role2, payload: rolePayload(true) },
        { id: schema, payload: {} },
        { id: newTable, parent: schema, payload: tablePayload() },
      ],
      [{ from: newTable, to: role2, kind: "owner" }],
    );

    const p = plan(source, desired, { renames: "auto", compact: false });

    const ownerActionIdx = p.actions.findIndex((a) =>
      a.sql.includes('OWNER TO "r2"'),
    );
    expect(ownerActionIdx).toBeGreaterThanOrEqual(0);
    const ownerAction = p.actions[ownerActionIdx]!;
    // the owner alter must release the old role so the drop is ordered after it
    expect(ownerAction.releases.map(encodeId)).toContain(encodeId(role1));

    const dropRoleIdx = p.actions.findIndex(
      (a) => a.verb === "drop" && a.sql.includes('DROP ROLE "r1"'),
    );
    expect(dropRoleIdx).toBeGreaterThanOrEqual(0);
    // ALTER … OWNER TO r2 must come BEFORE DROP ROLE r1 in the final order
    expect(ownerActionIdx).toBeLessThan(dropRoleIdx);
  });
});

describe("accepted table rename + accepted owner-role rename (review P1 #2)", () => {
  test("owner carried through both renames → no cycle, no spurious OWNER TO", () => {
    // r1 and r2 are structurally identical → the role rename is accepted too
    const source = buildFactBase(
      [
        { id: role1, payload: rolePayload(false) },
        { id: schema, payload: {} },
        { id: oldTable, parent: schema, payload: tablePayload() },
      ],
      [{ from: oldTable, to: role1, kind: "owner" }],
    );
    const desired = buildFactBase(
      [
        { id: role2, payload: rolePayload(false) },
        { id: schema, payload: {} },
        { id: newTable, parent: schema, payload: tablePayload() },
      ],
      [{ from: newTable, to: role2, kind: "owner" }],
    );

    let p!: ReturnType<typeof plan>;
    expect(() => {
      p = plan(source, desired, { renames: "auto", compact: false });
    }).not.toThrow();

    // both renames are emitted
    expect(p.actions.filter((a) => a.sql.includes("RENAME TO"))).toHaveLength(
      2,
    );
    // ownership is carried by the renames — no ALTER … OWNER TO is needed
    expect(p.actions.filter((a) => a.sql.includes("OWNER TO"))).toHaveLength(0);
  });

  test("canonical filtering can veto the table rename after owner normalization", () => {
    const source = buildFactBase(
      [
        { id: role1, payload: rolePayload(false) },
        { id: schema, payload: {} },
        { id: oldTable, parent: schema, payload: tablePayload() },
      ],
      [{ from: oldTable, to: role1, kind: "owner" }],
    );
    const desired = buildFactBase(
      [
        { id: role2, payload: rolePayload(false) },
        { id: schema, payload: {} },
        { id: newTable, parent: schema, payload: tablePayload() },
      ],
      [{ from: newTable, to: role2, kind: "owner" }],
    );

    const p = plan(source, desired, {
      renames: "auto",
      compact: false,
      policy: {
        id: "canonical-owner-filter",
        filter: [
          {
            match: {
              all: [
                { kind: "table" },
                { name: "old_t" },
                { owner: "r2" },
                { verb: "remove" },
              ],
            },
            action: "exclude",
          },
        ],
      },
    });
    const sql = p.actions.map((action) => action.sql);

    expect(sql).toContain('ALTER ROLE "r1" RENAME TO "r2"');
    expect(
      sql.some(
        (statement) =>
          statement.includes("ALTER TABLE") && statement.includes("RENAME TO"),
      ),
    ).toBe(false);
    expect(sql).toContain('CREATE TABLE "app"."new_t" ()');
    expect(p.acceptedRenames).toEqual([{ from: role1, to: role2 }]);
  });
});

describe("canonical filtering vetoes partial subtree renames", () => {
  test("a filtered desired column prevents its table rename", () => {
    const oldColumn: StableId = {
      kind: "column",
      schema: "app",
      table: "old_t",
      name: "c",
    };
    const newColumn: StableId = {
      kind: "column",
      schema: "app",
      table: "new_t",
      name: "c",
    };
    const source = buildFactBase(
      [
        { id: schema, payload: {} },
        { id: oldTable, parent: schema, payload: tablePayload() },
        { id: oldColumn, parent: oldTable, payload: { type: "integer" } },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        { id: schema, payload: {} },
        { id: newTable, parent: schema, payload: tablePayload() },
        { id: newColumn, parent: newTable, payload: { type: "integer" } },
      ],
      [],
    );

    const p = plan(source, desired, {
      renames: "auto",
      compact: false,
      policy: {
        id: "canonical-column-filter",
        filter: [
          {
            match: {
              all: [
                { kind: "column" },
                { name: "c" },
                { idField: { field: "table", glob: "new_t" } },
                { verb: "add" },
              ],
            },
            action: "exclude",
          },
        ],
      },
    });

    expect(
      p.actions.some(
        (action) =>
          action.sql.includes("ALTER TABLE") &&
          action.sql.includes("RENAME TO"),
      ),
    ).toBe(false);
    expect(p.acceptedRenames).toBeUndefined();
    expect(p.actions.map((action) => action.sql)).toContain(
      'CREATE TABLE "app"."new_t" ()',
    );
  });

  test("an orphaned filtered source child does not veto the table rename", () => {
    const oldColumn: StableId = {
      kind: "column",
      schema: "app",
      table: "old_t",
      name: "c",
    };
    const newColumn: StableId = {
      kind: "column",
      schema: "app",
      table: "new_t",
      name: "c",
    };
    const source = buildFactBase(
      [
        { id: schema, payload: {} },
        { id: oldTable, parent: schema, payload: tablePayload() },
        { id: oldColumn, parent: oldTable, payload: { type: "integer" } },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        { id: schema, payload: {} },
        { id: newTable, parent: schema, payload: tablePayload() },
        { id: newColumn, parent: newTable, payload: { type: "integer" } },
      ],
      [],
    );

    const p = plan(source, desired, {
      renames: "auto",
      compact: false,
      policy: {
        id: "orphaned-source-column-filter",
        filter: [
          {
            match: {
              all: [
                { kind: "column" },
                { name: "c" },
                { idField: { field: "table", glob: "old_t" } },
                { verb: "remove" },
              ],
            },
            action: "exclude",
          },
        ],
      },
    });

    expect(p.actions.map((action) => action.sql)).toEqual([
      'ALTER TABLE "app"."old_t" RENAME TO "new_t"',
    ]);
    expect(p.acceptedRenames).toEqual([{ from: oldTable, to: newTable }]);
  });
});

const stableTable: StableId = { kind: "table", schema: "app", name: "t" };

describe("role-only rename carries ownership on a stable object (review P1)", () => {
  // source: r1 owns app.t; desired: structurally identical r2 owns the SAME
  // app.t. Only the role is renamed; the table id does not change. PostgreSQL
  // carries the owner by OID across ALTER ROLE … RENAME, so no ALTER … OWNER TO
  // is needed and the role rename must not deadlock an owner action.
  const source = buildFactBase(
    [
      { id: role1, payload: rolePayload(false) },
      { id: schema, payload: {} },
      { id: stableTable, parent: schema, payload: tablePayload() },
    ],
    [{ from: stableTable, to: role1, kind: "owner" }],
  );
  const desired = buildFactBase(
    [
      { id: role2, payload: rolePayload(false) },
      { id: schema, payload: {} },
      { id: stableTable, parent: schema, payload: tablePayload() },
    ],
    [{ from: stableTable, to: role2, kind: "owner" }],
  );

  test("no cycle, ALTER ROLE rename emitted, no spurious OWNER TO", () => {
    let p!: ReturnType<typeof plan>;
    expect(() => {
      p = plan(source, desired, { renames: "auto", compact: false });
    }).not.toThrow();
    expect(
      p.actions.some((a) => a.sql.includes('ALTER ROLE "r1" RENAME TO "r2"')),
    ).toBe(true);
    expect(p.actions.filter((a) => a.sql.includes("OWNER TO"))).toHaveLength(0);
  });

  test("a restrictive capability does not falsely fail (no owner action to authorize)", () => {
    // applier cannot set owner r2; but no ALTER … OWNER TO is required, so plan
    // must not throw the capability error.
    expect(() =>
      plan(source, desired, {
        renames: "auto",
        compact: false,
        capability: { role: "applier", isSuperuser: false, memberOf: [] },
      }),
    ).not.toThrow();
  });
});

describe("role rename carries role-name-bearing facts (review P2)", () => {
  const dpPayload = { privileges: ["SELECT"], grantable: [] };

  test("identical default privileges are carried, not churned (no ALTER DEFAULT PRIVILEGES)", () => {
    const dp1: StableId = {
      kind: "defaultPrivilege",
      role: "r1",
      schema: "app",
      objtype: "r",
      grantee: "PUBLIC",
    };
    const dp2: StableId = {
      kind: "defaultPrivilege",
      role: "r2",
      schema: "app",
      objtype: "r",
      grantee: "PUBLIC",
    };
    const source = buildFactBase(
      [
        { id: role1, payload: rolePayload(false) },
        { id: schema, payload: {} },
        { id: dp1, payload: dpPayload },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        { id: role2, payload: rolePayload(false) },
        { id: schema, payload: {} },
        { id: dp2, payload: dpPayload },
      ],
      [],
    );

    const p = plan(source, desired, { renames: "auto", compact: false });
    expect(
      p.actions.some((a) => a.sql.includes('ALTER ROLE "r1" RENAME TO "r2"')),
    ).toBe(true);
    // the default privilege is carried by the role rename's OID — no DDL
    expect(
      p.actions.filter((a) => a.sql.includes("DEFAULT PRIVILEGES")),
    ).toHaveLength(0);
    expect(
      p.actions.filter(
        (a) => a.sql.includes("GRANT") || a.sql.includes("REVOKE"),
      ),
    ).toHaveLength(0);
  });

  test("identical membership is carried, not churned (no GRANT/REVOKE … membership)", () => {
    // r1 is a member of grp in source; after r1 → r2 the membership is carried
    const grp: StableId = { kind: "role", name: "grp" };
    const m1: StableId = { kind: "membership", role: "grp", member: "r1" };
    const m2: StableId = { kind: "membership", role: "grp", member: "r2" };
    const source = buildFactBase(
      [
        { id: grp, payload: rolePayload(false) },
        { id: role1, payload: rolePayload(false) },
        { id: m1, payload: { admin: false } },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        { id: grp, payload: rolePayload(false) },
        { id: role2, payload: rolePayload(false) },
        { id: m2, payload: { admin: false } },
      ],
      [],
    );

    const p = plan(source, desired, { renames: "auto", compact: false });
    expect(
      p.actions.some((a) => a.sql.includes('ALTER ROLE "r1" RENAME TO "r2"')),
    ).toBe(true);
    // the membership is carried — no GRANT/REVOKE role membership churn
    expect(
      p.actions.filter(
        (a) => a.sql.includes("GRANT") || a.sql.includes("REVOKE"),
      ),
    ).toHaveLength(0);
  });
});

describe("role rename carries role-name-bearing facts with CHANGED payloads (review P2, fourth)", () => {
  // PostgreSQL carries the role-referencing fact's IDENTITY through the rename
  // by OID; only the payload mutation needs DDL, applied to the post-rename id.
  // The planner must not tear down the old-name fact and recreate the new-name
  // one (extra DDL, REVOKE … CASCADE, transient privilege churn).
  const grp: StableId = { kind: "role", name: "grp" };

  test("membership.admin false→true: GRANT WITH ADMIN OPTION on r2, no REVOKE … CASCADE", () => {
    const source = buildFactBase(
      [
        { id: grp, payload: rolePayload(false) },
        { id: role1, payload: rolePayload(false) },
        {
          id: { kind: "membership", role: "grp", member: "r1" },
          payload: { admin: false },
        },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        { id: grp, payload: rolePayload(false) },
        { id: role2, payload: rolePayload(false) },
        {
          id: { kind: "membership", role: "grp", member: "r2" },
          payload: { admin: true },
        },
      ],
      [],
    );
    const p = plan(source, desired, { renames: "auto", compact: false });
    const sql = p.actions.map((a) => a.sql);
    expect(sql.some((s) => s.includes('ALTER ROLE "r1" RENAME TO "r2"'))).toBe(
      true,
    );
    expect(sql.some((s) => s === 'GRANT "grp" TO "r2" WITH ADMIN OPTION')).toBe(
      true,
    );
    // the old-name teardown (with CASCADE) must be gone
    expect(sql.some((s) => s.includes("CASCADE"))).toBe(false);
    expect(sql.some((s) => s.includes('FROM "r1"'))).toBe(false);
    const membershipAlter = p.actions.find((action) =>
      action.sql.includes("WITH ADMIN OPTION"),
    );
    expect(membershipAlter?.consumes).toContainEqual(role2);
  });

  test("membership.admin true→false: REVOKE ADMIN OPTION on r2, no drop/recreate", () => {
    const source = buildFactBase(
      [
        { id: grp, payload: rolePayload(false) },
        { id: role1, payload: rolePayload(false) },
        {
          id: { kind: "membership", role: "grp", member: "r1" },
          payload: { admin: true },
        },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        { id: grp, payload: rolePayload(false) },
        { id: role2, payload: rolePayload(false) },
        {
          id: { kind: "membership", role: "grp", member: "r2" },
          payload: { admin: false },
        },
      ],
      [],
    );
    const p = plan(source, desired, { renames: "auto", compact: false });
    const sql = p.actions.map((a) => a.sql);
    expect(sql.some((s) => s.includes('ALTER ROLE "r1" RENAME TO "r2"'))).toBe(
      true,
    );
    expect(
      sql.some((s) => s === 'REVOKE ADMIN OPTION FOR "grp" FROM "r2"'),
    ).toBe(true);
    expect(sql.some((s) => s.includes("CASCADE"))).toBe(false);
  });

  test("userMapping.options change: ALTER USER MAPPING on r2, no DROP/CREATE USER MAPPING", () => {
    const srv: StableId = { kind: "server", name: "srv" };
    const um1: StableId = { kind: "userMapping", server: "srv", role: "r1" };
    const um2: StableId = { kind: "userMapping", server: "srv", role: "r2" };
    const source = buildFactBase(
      [
        { id: role1, payload: rolePayload(false) },
        { id: srv, payload: { fdw: "postgres_fdw", options: [] } },
        { id: um1, parent: srv, payload: { options: ["a=b"] } },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        { id: role2, payload: rolePayload(false) },
        { id: srv, payload: { fdw: "postgres_fdw", options: [] } },
        { id: um2, parent: srv, payload: { options: ["a=c"] } },
      ],
      [],
    );
    const p = plan(source, desired, { renames: "auto", compact: false });
    const sql = p.actions.map((a) => a.sql);
    expect(sql.some((s) => s.includes('ALTER ROLE "r1" RENAME TO "r2"'))).toBe(
      true,
    );
    expect(
      sql.some((s) => s.includes("ALTER USER MAPPING") && s.includes('"r2"')),
    ).toBe(true);
    expect(sql.some((s) => s.includes("DROP USER MAPPING"))).toBe(false);
    expect(sql.some((s) => s.includes("CREATE USER MAPPING"))).toBe(false);
    const mappingAlter = p.actions.find((action) =>
      action.sql.includes("ALTER USER MAPPING"),
    );
    expect(mappingAlter?.consumes).toContainEqual(role2);
  });

  test("userMapping removal after rename targets and consumes r2", () => {
    const srv: StableId = { kind: "server", name: "srv" };
    const source = buildFactBase(
      [
        { id: role1, payload: rolePayload(false) },
        { id: srv, payload: { fdw: "postgres_fdw", options: [] } },
        {
          id: { kind: "userMapping", server: "srv", role: "r1" },
          parent: srv,
          payload: { options: [] },
        },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        { id: role2, payload: rolePayload(false) },
        { id: srv, payload: { fdw: "postgres_fdw", options: [] } },
      ],
      [],
    );

    const p = plan(source, desired, { renames: "auto", compact: false });
    const mappingDrop = p.actions.find((action) =>
      action.sql.includes("DROP USER MAPPING"),
    );
    expect(mappingDrop?.sql).toContain('FOR "r2"');
    expect(mappingDrop?.consumes).toContainEqual(role2);
    expect(p.actions.indexOf(mappingDrop!)).toBeGreaterThan(
      p.actions.findIndex((action) => action.sql.includes("RENAME TO")),
    );
  });

  test("acl privilege change: no pre-rename REVOKE FROM r1; replacement targets r2", () => {
    const table: StableId = { kind: "table", schema: "app", name: "t" };
    const acl1: StableId = { kind: "acl", target: table, grantee: "r1" };
    const acl2: StableId = { kind: "acl", target: table, grantee: "r2" };
    const source = buildFactBase(
      [
        { id: role1, payload: rolePayload(false) },
        { id: schema, payload: {} },
        { id: table, parent: schema, payload: tablePayload() },
        {
          id: acl1,
          parent: table,
          payload: { privileges: ["SELECT"], grantable: [] },
        },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        { id: role2, payload: rolePayload(false) },
        { id: schema, payload: {} },
        { id: table, parent: schema, payload: tablePayload() },
        {
          id: acl2,
          parent: table,
          payload: { privileges: ["SELECT", "INSERT"], grantable: [] },
        },
      ],
      [],
    );
    const p = plan(source, desired, { renames: "auto", compact: false });
    const sql = p.actions.map((a) => a.sql);
    expect(sql.some((s) => s.includes('ALTER ROLE "r1" RENAME TO "r2"'))).toBe(
      true,
    );
    // no pre-rename teardown against the old name
    expect(sql.some((s) => s.includes('FROM "r1"'))).toBe(false);
    // the new privileges are granted to the post-rename name
    expect(sql.some((s) => s.includes("GRANT") && s.includes('TO "r2"'))).toBe(
      true,
    );
  });

  test("defaultPrivilege privilege removal: REVOKE+GRANT against r2 only, no FOR ROLE r1", () => {
    const dp1: StableId = {
      kind: "defaultPrivilege",
      role: "r1",
      schema: "app",
      objtype: "r",
      grantee: "PUBLIC",
    };
    const dp2: StableId = {
      kind: "defaultPrivilege",
      role: "r2",
      schema: "app",
      objtype: "r",
      grantee: "PUBLIC",
    };
    const source = buildFactBase(
      [
        { id: role1, payload: rolePayload(false) },
        { id: schema, payload: {} },
        { id: dp1, payload: { privileges: ["SELECT"], grantable: [] } },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        { id: role2, payload: rolePayload(false) },
        { id: schema, payload: {} },
        { id: dp2, payload: { privileges: ["INSERT"], grantable: [] } },
      ],
      [],
    );
    const p = plan(source, desired, { renames: "auto", compact: false });
    const sql = p.actions.map((a) => a.sql);
    expect(sql.some((s) => s.includes('ALTER ROLE "r1" RENAME TO "r2"'))).toBe(
      true,
    );
    // no default-privilege DDL against the old role name
    expect(sql.some((s) => s.includes('FOR ROLE "r1"'))).toBe(false);
    // the privilege change is applied against the post-rename role: a REVOKE ALL
    // (so the dropped SELECT is removed) and a GRANT INSERT, both FOR ROLE r2
    expect(
      sql.some((s) => s.includes('FOR ROLE "r2"') && s.includes("REVOKE ALL")),
    ).toBe(true);
    expect(
      sql.some(
        (s) => s.includes('FOR ROLE "r2"') && s.includes("GRANT INSERT"),
      ),
    ).toBe(true);
  });
});
