/**
 * Owner-as-edge integration tests (managed-view-architecture move 2).
 *
 * Object ownership is now an `owner` EDGE (object --owner--> role), not a
 * payload field. The planner emits `ALTER <KIND> OWNER TO` from owner-edge
 * link deltas; an out-of-view owner role prunes the edge → the object is
 * created ownerless — no skipAuthorization param needed.
 *
 * Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../src/core/fact.ts";
import type { StableId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import type { Policy } from "../src/policy/policy.ts";
import type { ApplierCapability } from "../src/policy/capability.ts";
import {
  isolatedClusterPair,
  sharedCluster,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

// ---------------------------------------------------------------------------
// Test (a): owner roundtrip — the owner edge is emitted and the plan applies
// ---------------------------------------------------------------------------

describe("owner edge: owner roundtrip proves clean", () => {
  test("schema + table owned by role r → plan(empty, desired) → provePlan → ok, zero drift", async () => {
    const [clusterA, clusterB] = await isolatedClusterPair();

    const srcDb = await clusterA.createDb("ownedge_rtrip_src");
    const dstDb = await clusterB.createDb("ownedge_rtrip_dst");
    dbs.push(srcDb, dstDb);

    // Role r exists on BOTH clusters (source clone needs it to be the owner)
    await clusterA.adminPool
      .query(`CREATE ROLE ownedge_r NOLOGIN`)
      .catch(() => {});
    await clusterB.adminPool
      .query(`CREATE ROLE ownedge_r NOLOGIN`)
      .catch(() => {});

    // Desired: schema s owned by ownedge_r, table s.t owned by ownedge_r
    await dstDb.pool.query(`
        CREATE SCHEMA s AUTHORIZATION ownedge_r;
        CREATE TABLE s.t (id int);
        ALTER TABLE s.t OWNER TO ownedge_r;
      `);

    const [srcState, dstState] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
    ]);

    const thePlan = plan(srcState.factBase, dstState.factBase);

    // Should produce ALTER ... OWNER TO actions
    const ownerActions = thePlan.actions.filter((a) =>
      a.sql.includes("OWNER TO"),
    );
    expect(ownerActions.length).toBeGreaterThan(0);

    // provePlan against a clone of the source cluster A (which has the role)
    const clone = await srcDb.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Test (b): owner change — unlink old owner + link new owner → ALTER OWNER TO
// ---------------------------------------------------------------------------

describe("owner edge: owner change emits ALTER OWNER TO", () => {
  test("s.t owned by r1 in source, owned by r2 in desired → ALTER TABLE s.t OWNER TO r2", async () => {
    const cluster = await sharedCluster();
    const srcDb = await cluster.createDb("ownedge_chg_src");
    const dstDb = await cluster.createDb("ownedge_chg_dst");
    dbs.push(srcDb, dstDb);

    // Create both roles in the shared cluster
    await cluster.adminPool
      .query(`CREATE ROLE ownedge_r1 NOLOGIN`)
      .catch(() => {});
    await cluster.adminPool
      .query(`CREATE ROLE ownedge_r2 NOLOGIN`)
      .catch(() => {});

    // Source: schema s + table owned by r1
    await srcDb.pool.query(`
        CREATE SCHEMA s AUTHORIZATION ownedge_r1;
        CREATE TABLE s.t (id int);
        ALTER TABLE s.t OWNER TO ownedge_r1;
      `);

    // Desired: same schema s + table, but owned by r2
    await dstDb.pool.query(`
        CREATE SCHEMA s AUTHORIZATION ownedge_r2;
        CREATE TABLE s.t (id int);
        ALTER TABLE s.t OWNER TO ownedge_r2;
      `);

    const [srcState, dstState] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
    ]);

    const thePlan = plan(srcState.factBase, dstState.factBase);

    // Should contain an `ALTER … OWNER TO ownedge_r2` action (identifiers are
    // quoted, e.g. ALTER TABLE "s"."t" OWNER TO "ownedge_r2" — match on the new
    // owner, not an unquoted "s.t").
    const ownerToR2 = thePlan.actions.filter(
      (a) => a.sql.includes("OWNER TO") && a.sql.includes("ownedge_r2"),
    );
    expect(ownerToR2.length).toBeGreaterThan(0);

    // provePlan on clone of src
    const clone = await srcDb.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Test (c): system-role owner projection (skipAuthorization elimination)
// Unit-level: synthetic fact base, no Docker needed for the core assertion.
// ---------------------------------------------------------------------------

describe("owner edge: out-of-view owner role prunes ownership (skipAuth elimination)", () => {
  test("schema app with owner edge to role sys (excluded by policy) → CREATE SCHEMA app, NO ALTER OWNER TO", () => {
    const f = (id: StableId, parent?: StableId): Fact =>
      parent ? { id, parent, payload: {} } : { id, payload: {} };

    const schemaId: StableId = { kind: "schema", name: "app" };
    const roleId: StableId = { kind: "role", name: "sys" };

    // Source: empty
    const source = buildFactBase([], []);

    // Desired: schema app + role sys + owner edge
    const desired = buildFactBase(
      [f(schemaId), f(roleId)],
      [{ from: schemaId, to: roleId, kind: "owner" }],
    );

    // Policy: exclude the sys role (by kind+name)
    const excludeSysRole: Policy = {
      id: "test-skipauth",
      filter: [
        {
          match: { all: [{ kind: "role" }, { name: "sys" }] },
          action: "exclude",
        },
      ],
    };

    // plan() should NOT throw (owner edge is pruned with its endpoint)
    const thePlan = plan(source, desired, { policy: excludeSysRole });

    // There must be a CREATE SCHEMA app action
    const createSchema = thePlan.actions.find(
      (a) =>
        a.verb === "create" &&
        a.produces.some(
          (id) =>
            id.kind === "schema" && (id as { name: string }).name === "app",
        ),
    );
    expect(createSchema).toBeDefined();

    // There must be NO ALTER SCHEMA OWNER TO action
    const ownerAction = thePlan.actions.find((a) => a.sql.includes("OWNER TO"));
    expect(ownerAction).toBeUndefined();

    // …and ownership must not leak via a folded CREATE SCHEMA AUTHORIZATION
    // either — the excluded role must never appear in any emitted SQL.
    const authLeak = thePlan.actions.find((a) =>
      a.sql.includes('AUTHORIZATION "sys"'),
    );
    expect(authLeak).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test (c'): a policy-excluded owner role must NOT be laundered back in via a
// retained dangling owner edge. A kept object (schema app) carries a USAGE
// ACL grant to the excluded role `sys`; excluding `sys` prunes the owner edge
// AND leaves the ACL's requirement on `sys` unsatisfied, so the planner must
// FAIL FAST with a missing-requirement error rather than silently assuming the
// role via the (previously) retained owner edge. Unit-level, no Docker.
// ---------------------------------------------------------------------------

describe("owner edge: policy-excluded owner role is not laundered back via a dangling owner edge", () => {
  test("kept schema's ACL grant to excluded role sys → plan throws missing requirement", () => {
    const schemaId: StableId = { kind: "schema", name: "app" };
    const roleId: StableId = { kind: "role", name: "sys" };
    const aclId: StableId = {
      kind: "acl",
      target: schemaId,
      grantee: "sys",
    };

    // Source: empty
    const source = buildFactBase([], []);

    // Desired: schema app + role sys + a USAGE grant to sys + owner edge to sys
    const desired = buildFactBase(
      [
        { id: schemaId, payload: {} },
        { id: roleId, payload: {} },
        {
          id: aclId,
          parent: schemaId,
          payload: { privileges: ["USAGE"], grantable: [] },
        },
      ],
      [{ from: schemaId, to: roleId, kind: "owner" }],
    );

    // Exclude every role (NO scope) — sys is projected out of the view.
    expect(() =>
      plan(source, desired, {
        policy: {
          id: "t",
          filter: [{ match: { kind: "role" }, action: "exclude" }],
        },
      }),
    ).toThrow(/missing requirement/);
  });
});

// ---------------------------------------------------------------------------
// Test (d): accepted table rename + owner CHANGE — the renamed table is owned
// by a NEW role; the old role is dropped. The owner reassignment must sort
// BEFORE the old role drop, or `DROP OWNED BY old; DROP ROLE old` drops the
// still-old-owned renamed table (second follow-up review, P1 #1).
//
// We prove against the SOURCE database directly (it is sacrificial), NOT a
// clone: roles are cluster-global, so a clone leaves the original source db
// owning the table via the old role — `DROP ROLE` then fails on a cross-
// database dependency that has nothing to do with the plan. Applying on the
// source itself is the same pattern renames.test.ts uses.
// ---------------------------------------------------------------------------

describe("owner edge: accepted rename + owner change drops old role last (P1 #1)", () => {
  test("ALTER … OWNER TO new sorts before DROP ROLE old; proof is clean", async () => {
    const [clusterA, clusterB] = await isolatedClusterPair();
    const srcDb = await clusterA.createDb("ren_ownchg_src");
    const dstDb = await clusterB.createDb("ren_ownchg_dst");
    dbs.push(srcDb, dstDb);

    // source: role renown1_old (NOLOGIN) owns app.old_t
    await clusterA.adminPool
      .query(`CREATE ROLE renown1_old NOLOGIN`)
      .catch(() => {});
    await srcDb.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.old_t (id int, name text);
        ALTER TABLE app.old_t OWNER TO renown1_old;
      `);

    // desired: app.new_t (a structural rename of old_t) owned by a DIFFERENT
    // role renown1_new. LOGIN ≠ NOLOGIN keeps the roles from matching as a
    // rename, so this is a genuine owner CHANGE + old-role drop.
    await clusterB.adminPool
      .query(`CREATE ROLE renown1_new LOGIN`)
      .catch(() => {});
    await dstDb.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.new_t (id int, name text);
        ALTER TABLE app.new_t OWNER TO renown1_new;
      `);

    const [srcState, dstState] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
    ]);
    const thePlan = plan(srcState.factBase, dstState.factBase, {
      renames: "auto",
    });

    // it is a RENAME (not drop+create) and emits ALTER … OWNER TO renown1_new
    expect(thePlan.actions.some((a) => a.sql.includes("RENAME TO"))).toBe(true);
    const ownerIdx = thePlan.actions.findIndex(
      (a) => a.sql.includes("OWNER TO") && a.sql.includes("renown1_new"),
    );
    expect(ownerIdx).toBeGreaterThanOrEqual(0);
    const dropOldIdx = thePlan.actions.findIndex(
      (a) => a.verb === "drop" && a.sql.includes("renown1_old"),
    );
    expect(dropOldIdx).toBeGreaterThanOrEqual(0);
    // the reassignment must precede the old role drop
    expect(ownerIdx).toBeLessThan(dropOldIdx);

    const verdict = await provePlan(thePlan, srcDb.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Test (e): accepted table rename + accepted owner-ROLE rename. PostgreSQL
// carries the owner OID across both renames, so NO `ALTER … OWNER TO` is
// needed and the two renames must not deadlock each other (P1 #2 cycle).
//
// Roles are cluster-global, so to keep the role rename UNAMBIGUOUS regardless
// of leftover roles from other tests, the pair carries a distinctive role
// config (statement_timeout) that no other test uses → its structural rollup
// is unique → exactly one removed × one added. Proven against the source db
// directly (sacrificial), as in test (d).
// ---------------------------------------------------------------------------

describe("owner edge: table rename + owner-role rename carries ownership (P1 #2)", () => {
  test("both renames emitted, no spurious OWNER TO, no cycle; proof clean", async () => {
    const [clusterA, clusterB] = await isolatedClusterPair();
    const srcDb = await clusterA.createDb("ren_ownren_src");
    const dstDb = await clusterB.createDb("ren_ownren_dst");
    dbs.push(srcDb, dstDb);

    // renown2_a (source) and renown2_b (desired) share a distinctive config so
    // their structural rollup matches each other and nothing else → the role
    // rename is unambiguous despite other tests' cluster-global roles.
    await clusterA.adminPool
      .query(`CREATE ROLE renown2_a NOLOGIN`)
      .catch(() => {});
    await clusterA.adminPool
      .query(`ALTER ROLE renown2_a SET statement_timeout = '31337ms'`)
      .catch(() => {});
    await srcDb.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.old_t (id int, name text);
        ALTER TABLE app.old_t OWNER TO renown2_a;
      `);

    await clusterB.adminPool
      .query(`CREATE ROLE renown2_b NOLOGIN`)
      .catch(() => {});
    await clusterB.adminPool
      .query(`ALTER ROLE renown2_b SET statement_timeout = '31337ms'`)
      .catch(() => {});
    await dstDb.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.new_t (id int, name text);
        ALTER TABLE app.new_t OWNER TO renown2_b;
      `);

    const [srcState, dstState] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
    ]);
    // must not throw a dependency cycle
    const thePlan = plan(srcState.factBase, dstState.factBase, {
      renames: "auto",
    });

    // both the table and the role are renamed
    expect(
      thePlan.actions.filter((a) => a.sql.includes("RENAME TO")),
    ).toHaveLength(2);
    // ownership is carried by the renames — no ALTER … OWNER TO is emitted
    expect(
      thePlan.actions.filter((a) => a.sql.includes("OWNER TO")),
    ).toHaveLength(0);

    const verdict = await provePlan(thePlan, srcDb.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Test (d): owner residue (follow-up 1). A non-superuser applier that is not a
// member of an object's owner role cannot run ALTER … OWNER TO. The owner can't
// be silently skipped (acldefault is owner-relative → no convergence), so the
// planner FAILS FAST with an actionable error, surfaced before any apply.
// ---------------------------------------------------------------------------

describe("owner edge: owner residue — applier can't set owner → fail fast", () => {
  test("a non-superuser capability rejects a plan that must set an unsettable owner", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("cap_owner_src");
    const dst = await cluster.createDb("cap_owner_dst");
    dbs.push(src, dst);
    await cluster.adminPool
      .query(`CREATE ROLE cap_other_owner NOLOGIN`)
      .catch(() => {});
    // desired: a schema + table owned by cap_other_owner
    await dst.pool.query(`
        CREATE SCHEMA caps AUTHORIZATION cap_other_owner;
        CREATE TABLE caps.t (id int);
        ALTER TABLE caps.t OWNER TO cap_other_owner;
      `);

    const [srcState, dstState] = await Promise.all([
      extract(src.pool),
      extract(dst.pool),
    ]);

    // an applier that is a member of NO role (so it cannot set owner to
    // cap_other_owner). isSuperuser:false forces the capability check.
    const capability: ApplierCapability = {
      role: "applier",
      isSuperuser: false,
      memberOf: [],
    };

    expect(() =>
      plan(srcState.factBase, dstState.factBase, { capability }),
    ).toThrow(/cannot set owner/);

    // a superuser applier (or none) plans fine — the objects + owner ALTERs land
    expect(() => plan(srcState.factBase, dstState.factBase)).not.toThrow();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Test (f): ROLE-ONLY rename carries ownership of a STABLE object. The table
// id does not change; only its owner role is renamed. PostgreSQL carries the
// owner by OID, so NO ALTER … OWNER TO is needed and the role rename must not
// deadlock an owner action (third follow-up review P1). Proven against the
// sacrificial source directly (roles are cluster-global).
// ---------------------------------------------------------------------------

describe("owner edge: role-only rename carries ownership of a stable object (P1)", () => {
  test("ALTER ROLE rename only, no OWNER TO, no cycle; proof clean", async () => {
    const [clusterA, clusterB] = await isolatedClusterPair();
    const srcDb = await clusterA.createDb("roleonly_src");
    const dstDb = await clusterB.createDb("roleonly_dst");
    dbs.push(srcDb, dstDb);

    // distinctive config so the rr1→rr2 role rename is unambiguous despite
    // other tests' cluster-global roles
    await clusterA.adminPool
      .query(`CREATE ROLE rolly_r1 NOLOGIN`)
      .catch(() => {});
    await clusterA.adminPool
      .query(`ALTER ROLE rolly_r1 SET statement_timeout = '24680ms'`)
      .catch(() => {});
    await srcDb.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id int, name text);
        ALTER TABLE app.t OWNER TO rolly_r1;
      `);

    await clusterB.adminPool
      .query(`CREATE ROLE rolly_r2 NOLOGIN`)
      .catch(() => {});
    await clusterB.adminPool
      .query(`ALTER ROLE rolly_r2 SET statement_timeout = '24680ms'`)
      .catch(() => {});
    await dstDb.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id int, name text);
        ALTER TABLE app.t OWNER TO rolly_r2;
      `);

    const [srcState, dstState] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
    ]);
    const thePlan = plan(srcState.factBase, dstState.factBase, {
      renames: "auto",
    });

    expect(
      thePlan.actions.some(
        (a) => a.sql.includes("ALTER ROLE") && a.sql.includes("RENAME TO"),
      ),
    ).toBe(true);
    // the table id is stable and the owner is carried by the role rename — no
    // ALTER … OWNER TO
    expect(
      thePlan.actions.filter((a) => a.sql.includes("OWNER TO")),
    ).toHaveLength(0);

    const verdict = await provePlan(thePlan, srcDb.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Test (g): a role rename CARRIES its default privileges (P2). Identical
// default privileges FOR the renamed role are carried by OID — no ALTER
// DEFAULT PRIVILEGES churn — and the plan still converges.
// ---------------------------------------------------------------------------

describe("owner edge: role rename carries default privileges (P2)", () => {
  test("no ALTER DEFAULT PRIVILEGES churn; proof clean", async () => {
    const [clusterA, clusterB] = await isolatedClusterPair();
    const srcDb = await clusterA.createDb("defacl_carry_src");
    const dstDb = await clusterB.createDb("defacl_carry_dst");
    dbs.push(srcDb, dstDb);

    await clusterA.adminPool
      .query(`CREATE ROLE dacl_r1 NOLOGIN`)
      .catch(() => {});
    await clusterA.adminPool
      .query(`ALTER ROLE dacl_r1 SET statement_timeout = '13579ms'`)
      .catch(() => {});
    await srcDb.pool.query(`
        CREATE SCHEMA app;
        ALTER DEFAULT PRIVILEGES FOR ROLE dacl_r1 IN SCHEMA app
          GRANT SELECT ON TABLES TO PUBLIC;
      `);

    await clusterB.adminPool
      .query(`CREATE ROLE dacl_r2 NOLOGIN`)
      .catch(() => {});
    await clusterB.adminPool
      .query(`ALTER ROLE dacl_r2 SET statement_timeout = '13579ms'`)
      .catch(() => {});
    await dstDb.pool.query(`
        CREATE SCHEMA app;
        ALTER DEFAULT PRIVILEGES FOR ROLE dacl_r2 IN SCHEMA app
          GRANT SELECT ON TABLES TO PUBLIC;
      `);

    const [srcState, dstState] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
    ]);
    const thePlan = plan(srcState.factBase, dstState.factBase, {
      renames: "auto",
    });

    expect(
      thePlan.actions.some(
        (a) => a.sql.includes("ALTER ROLE") && a.sql.includes("RENAME TO"),
      ),
    ).toBe(true);
    // the default privilege is carried by the role rename's OID — no DDL
    expect(
      thePlan.actions.filter((a) => a.sql.includes("DEFAULT PRIVILEGES")),
    ).toHaveLength(0);

    const verdict = await provePlan(thePlan, srcDb.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Test (h): a role rename CARRIES identical role-name-bearing facts across
// multiple catalog families at once — table ACL, role membership, and user
// mapping (review P3b). None should churn; only the role rename is emitted.
// ---------------------------------------------------------------------------

describe("owner edge: role rename carries acl + membership + user mapping (P3b)", () => {
  test("only ALTER ROLE rename; no GRANT/REVOKE/USER MAPPING churn; proof clean", async () => {
    const [clusterA, clusterB] = await isolatedClusterPair();
    const srcDb = await clusterA.createDb("carry_multi_src");
    const dstDb = await clusterB.createDb("carry_multi_dst");
    dbs.push(srcDb, dstDb);

    const setup = (role: string) => `
        CREATE EXTENSION IF NOT EXISTS postgres_fdw;
        CREATE ROLE carry_grp NOLOGIN;
        CREATE ROLE ${role} NOLOGIN;
        ALTER ROLE ${role} SET statement_timeout = '22446ms';
        GRANT carry_grp TO ${role};
        CREATE SCHEMA app;
        CREATE TABLE app.t (id int);
        GRANT SELECT ON app.t TO ${role};
        CREATE SERVER carry_srv FOREIGN DATA WRAPPER postgres_fdw;
        CREATE USER MAPPING FOR ${role} SERVER carry_srv OPTIONS (user 'alice');
      `;
    // setup() creates carry_grp + the renamed role on each side; carry_grp is
    // identical on both so only the renamed role differs, and its
    // statement_timeout config makes the rename unambiguous.
    await srcDb.pool.query(setup("carry_r1"));
    await dstDb.pool.query(setup("carry_r2"));

    const [srcState, dstState] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
    ]);
    const thePlan = plan(srcState.factBase, dstState.factBase, {
      renames: "auto",
    });

    expect(
      thePlan.actions.some(
        (a) => a.sql.includes("ALTER ROLE") && a.sql.includes("RENAME TO"),
      ),
    ).toBe(true);
    // every role-name-bearing fact is carried by OID — zero churn
    for (const a of thePlan.actions) {
      expect(a.sql).not.toContain("GRANT");
      expect(a.sql).not.toContain("REVOKE");
      expect(a.sql).not.toContain("USER MAPPING");
    }

    const verdict = await provePlan(thePlan, srcDb.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Test (i): a role rename CARRIES a user mapping whose OPTIONS also changed —
// the identity is carried by OID and only ALTER USER MAPPING is emitted, never
// DROP/CREATE USER MAPPING (review P2/P3b: payload-changing live proof).
// ---------------------------------------------------------------------------

describe("owner edge: role rename + user-mapping option change → ALTER USER MAPPING (P2)", () => {
  test("ALTER USER MAPPING on the renamed role, no drop/create; proof clean", async () => {
    const [clusterA, clusterB] = await isolatedClusterPair();
    const srcDb = await clusterA.createDb("carry_umopt_src");
    const dstDb = await clusterB.createDb("carry_umopt_dst");
    dbs.push(srcDb, dstDb);

    await clusterA.adminPool
      .query(`CREATE ROLE umopt_r1 NOLOGIN`)
      .catch(() => {});
    await clusterA.adminPool
      .query(`ALTER ROLE umopt_r1 SET statement_timeout = '33557ms'`)
      .catch(() => {});
    await srcDb.pool.query(`
        CREATE EXTENSION IF NOT EXISTS postgres_fdw;
        CREATE SERVER umopt_srv FOREIGN DATA WRAPPER postgres_fdw;
        CREATE USER MAPPING FOR umopt_r1 SERVER umopt_srv OPTIONS (user 'alice');
      `);

    await clusterB.adminPool
      .query(`CREATE ROLE umopt_r2 NOLOGIN`)
      .catch(() => {});
    await clusterB.adminPool
      .query(`ALTER ROLE umopt_r2 SET statement_timeout = '33557ms'`)
      .catch(() => {});
    await dstDb.pool.query(`
        CREATE EXTENSION IF NOT EXISTS postgres_fdw;
        CREATE SERVER umopt_srv FOREIGN DATA WRAPPER postgres_fdw;
        CREATE USER MAPPING FOR umopt_r2 SERVER umopt_srv OPTIONS (user 'bob');
      `);

    const [srcState, dstState] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
    ]);
    const thePlan = plan(srcState.factBase, dstState.factBase, {
      renames: "auto",
    });

    expect(
      thePlan.actions.some(
        (a) => a.sql.includes("ALTER ROLE") && a.sql.includes("RENAME TO"),
      ),
    ).toBe(true);
    expect(
      thePlan.actions.some((a) => a.sql.includes("ALTER USER MAPPING")),
    ).toBe(true);
    expect(
      thePlan.actions.some((a) => a.sql.includes("DROP USER MAPPING")),
    ).toBe(false);
    expect(
      thePlan.actions.some((a) => a.sql.includes("CREATE USER MAPPING")),
    ).toBe(false);

    const verdict = await provePlan(thePlan, srcDb.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});
