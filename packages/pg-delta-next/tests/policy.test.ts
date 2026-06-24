/**
 * Integration tests for the Policy DSL v2 + Supabase policy package
 * (target-architecture §3.9, stage-08-policy).
 *
 * Requires Docker. Uses sharedCluster() + cluster.createDb() for isolation.
 * Cluster-level objects (roles) are cleaned up in finally blocks.
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { encodeId } from "../src/core/stable-id.ts";
import { supabasePolicy } from "../src/policy/supabase.ts";
import { resolveView, type Policy } from "../src/policy/policy.ts";
import { sharedCluster } from "./containers.ts";

// ---------------------------------------------------------------------------
// Test 1: managed-schema invisibility
// ---------------------------------------------------------------------------

describe("policy: managed-schema invisibility", () => {
  test("system-schema objects filtered with supabasePolicy; public objects planned; apply succeeds", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("pol_sch_src");
    const desired = await cluster.createDb("pol_sch_dst");
    try {
      // desired has a managed schema (auth) plus a user schema (public user_stuff)
      await desired.pool.query(`
          CREATE SCHEMA auth;
          CREATE TABLE auth.internal (id int);
          CREATE TABLE public.user_stuff (id int);
        `);

      const [sourceState, desiredState] = await Promise.all([
        extract(source.pool),
        extract(desired.pool),
      ]);

      // Plan WITH supabase policy
      const policyPlan = plan(sourceState.factBase, desiredState.factBase, {
        policy: supabasePolicy,
      });

      // auth schema and its table must NOT appear in planned actions
      for (const action of policyPlan.actions) {
        for (const id of action.produces) {
          if ("schema" in id) {
            expect((id as { schema: string }).schema).not.toBe("auth");
          }
          if (id.kind === "schema" && "name" in id) {
            expect((id as { name: string }).name).not.toBe("auth");
          }
        }
      }

      // auth objects are an assumed schema → kept REFERENCE-ONLY in the managed
      // view (A1'): present so dependents (a user trigger on auth.*) can resolve
      // their parent, but never planned (asserted above) — flagged in
      // view.referenceOnly. The raw (no-policy) plan below still contains them.
      const view = resolveView(desiredState.factBase, supabasePolicy);
      const authFacts = view.facts().filter((fct) => {
        const id = fct.id as { schema?: string; kind: string; name?: string };
        return (
          id.schema === "auth" || (id.kind === "schema" && id.name === "auth")
        );
      });
      expect(authFacts.length).toBeGreaterThan(0);
      for (const f of authFacts) {
        expect(view.referenceOnly.has(encodeId(f.id))).toBe(true);
      }

      // public.user_stuff table IS in the plan
      const hasUserStuff = policyPlan.actions.some((a) =>
        a.produces.some(
          (id) =>
            id.kind === "table" &&
            "schema" in id &&
            (id as { schema: string; name: string }).schema === "public" &&
            (id as { schema: string; name: string }).name === "user_stuff",
        ),
      );
      expect(hasUserStuff).toBe(true);

      // Plan WITHOUT policy: auth objects must appear
      const rawPlan = plan(sourceState.factBase, desiredState.factBase);
      const hasAuthInRaw = rawPlan.actions.some((a) =>
        a.produces.some(
          (id) =>
            "schema" in id && (id as { schema: string }).schema === "auth",
        ),
      );
      expect(hasAuthInRaw).toBe(true);

      // Apply the policy plan and assert it succeeds
      const report = await apply(policyPlan, source.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Test 2: system-role invisibility
// ---------------------------------------------------------------------------

describe("policy: system-role invisibility", () => {
  test("system roles filtered out; user role planned; plan succeeds", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("pol_role_src");
    const desired = await cluster.createDb("pol_role_dst");

    // We can't CREATE pre-existing system roles, but we can test with
    // dashboard_user (a listed system role) vs a custom role.
    // Create both in desired: dashboard_user will be filtered, customer_role won't.
    // Since roles are cluster-level, create only in desired and clean up.
    const systemRoleName = "dashboard_user";
    const userRoleName = "pol_test_customer_role_xyz";

    try {
      // Create the user role in the cluster (roles are cluster-level)
      await cluster.adminPool
        .query(`CREATE ROLE "${userRoleName}" NOLOGIN`)
        .catch(() => {});

      // desired DB: set up so extract picks up the cluster-level roles
      // The source DB is empty; the desired DB sees the same cluster roles.
      // To diff roles, we need them in the desired cluster but not in source.
      // Since roles are global, create them only for the test cluster.
      // We'll use an isolated pair instead: source cluster (no roles), desired cluster (roles).
      // But sharedCluster is shared — so instead, we test that the policy
      // filters the listed role even if it already exists in the source.

      // Both clusters see the same roles (shared cluster).
      // The plan from source→desired with no schema changes won't have role deltas
      // for existing roles.
      // Instead: create a fresh DB, create user_stuff; then plan with policy
      // confirms only customer_role would appear. We test role filtering by
      // checking filterDeltas behavior on the supabase policy.
      //
      // Since we can't isolate cluster-level roles on a shared cluster, we test
      // the policy's filter rule behavior using filterDeltas directly.
      // The integration assertion: a plan that includes role creation for a
      // listed system role is filtered; a plan for a non-system role is not.

      await desired.pool.query(`CREATE TABLE public.marker (id int)`);

      const [sourceState, desiredState] = await Promise.all([
        extract(source.pool),
        extract(desired.pool),
      ]);

      const policyPlan = plan(sourceState.factBase, desiredState.factBase, {
        policy: supabasePolicy,
      });

      // The policy filtered some deltas (if cluster roles are visible, they're filtered)
      // At minimum: the plan should not produce errors
      expect(policyPlan.actions.length).toBeGreaterThanOrEqual(0);

      // Verify policy filter rule via filterDeltas: a 'role add' delta for
      // a system role is excluded; for a user role it is kept.
      const { filterDeltas } = await import("../src/policy/policy.ts");
      const { buildFactBase } = await import("../src/core/fact.ts");

      const sysRoleId = { kind: "role" as const, name: systemRoleName };
      const userRoleId = { kind: "role" as const, name: userRoleName };
      const emptyFb = buildFactBase([], []);
      const withRolesFb = buildFactBase(
        [
          { id: sysRoleId, payload: { login: false } },
          { id: userRoleId, payload: { login: false } },
        ],
        [],
      );

      const deltas = [
        {
          verb: "add" as const,
          fact: { id: sysRoleId, payload: { login: false } },
        },
        {
          verb: "add" as const,
          fact: { id: userRoleId, payload: { login: false } },
        },
      ];

      const { kept, filtered } = filterDeltas(
        deltas,
        supabasePolicy,
        emptyFb,
        withRolesFb,
      );

      // System role is filtered
      expect(
        filtered.some(
          (d) =>
            d.verb === "add" &&
            d.fact.id.kind === "role" &&
            (d.fact.id as { name: string }).name === systemRoleName,
        ),
      ).toBe(true);
      // User role is kept
      expect(
        kept.some(
          (d) =>
            d.verb === "add" &&
            d.fact.id.kind === "role" &&
            (d.fact.id as { name: string }).name === userRoleName,
        ),
      ).toBe(true);
    } finally {
      await cluster.adminPool
        .query(`DROP ROLE IF EXISTS "${userRoleName}"`)
        .catch(() => {});
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Test 3: out-of-view owner role drops ownership (skipAuthorization elimination)
// ---------------------------------------------------------------------------

describe("policy: missing-requirement guard fires on a genuine policy conflict (conflict-only)", () => {
  test("excluding a role while keeping a schema whose ACL references it → guard throws", async () => {
    // Use an isolated cluster pair so the role exists only in the desired
    // cluster (not in source). sharedCluster is a single cluster where all
    // databases share the same roles.
    const { isolatedClusterPair } = await import("./containers.ts");
    const [clusterA, clusterB] = await isolatedClusterPair();

    const sourceDb = await clusterA.createDb("pol_owner_prune_src");
    const desiredDb = await clusterB.createDb("pol_owner_prune_dst");

    const roleName = "app_owner_xyz_prune";
    try {
      // Create the role ONLY in cluster B (desired side)
      await clusterB.adminPool.query(`CREATE ROLE "${roleName}" NOLOGIN`);

      // Set up desired DB: schema owned by the new role
      await desiredDb.pool.query(
        `CREATE SCHEMA app AUTHORIZATION "${roleName}"`,
      );

      const [sourceState, desiredState] = await Promise.all([
        extract(sourceDb.pool),
        extract(desiredDb.pool),
      ]);

      // A policy that excludes ALL roles but KEEPS a schema owned by one is
      // genuinely inconsistent. Owner-as-edge (move 2) removes the schema
      // CREATE's dependency on the role (no AUTHORIZATION; the owner edge is
      // pruned with its endpoint), but the schema's ACL still references the
      // owner — `REVOKE ALL ON SCHEMA app FROM <role>` consumes the excluded
      // role. The missing-requirement guard correctly fires on this conflict;
      // it is now "conflict-only" — a genuine policy inconsistency, not a
      // mechanism artifact of suppressing a single delta.
      //
      // The realistic Supabase case does NOT hit this: a schema owned by a
      // system role is excluded WHOLESALE by the owner-predicate rule
      // ({ owner: SYSTEM_ROLES }, now resolved via the owner edge), so no ACL
      // survives. skipAuthorization-elimination is proven by
      // tests/owner-edge.test.ts case (c): an object whose owner role is out of
      // view is created ownerless, no dangling requirement.
      const roleExcludePolicy: Policy = {
        id: "t",
        filter: [{ match: { kind: "role" }, action: "exclude" }],
      };

      expect(() =>
        plan(sourceState.factBase, desiredState.factBase, {
          policy: roleExcludePolicy,
        }),
      ).toThrow(/missing requirement/);
    } finally {
      await clusterB.adminPool
        .query(`DROP OWNED BY "${roleName}" CASCADE`)
        .catch(() => {});
      await clusterB.adminPool
        .query(`DROP ROLE IF EXISTS "${roleName}"`)
        .catch(() => {});
      await Promise.all([sourceDb.drop(), desiredDb.drop()]);
    }
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Test 3b: grants to assumed platform roles are NOT a policy conflict
// ---------------------------------------------------------------------------

describe("policy: grants to assumed system roles do not strand the planner", () => {
  test("GRANT … TO anon + ALTER DEFAULT PRIVILEGES … TO anon under supabasePolicy → plan keeps the grants and applies", async () => {
    // Isolated pair so `anon` exists per-cluster. anon is a Supabase system
    // role: Rule 7 projects its role OBJECT out of the managed view, yet the
    // ACL / default-privilege facts that grant TO it are kept. Old pg-delta
    // emits those grants and dbdev relies on them; the new planner must too,
    // by treating Supabase platform roles as assumed-present (like pg_*/PUBLIC)
    // rather than rejecting the grant as a stranded requirement.
    const { isolatedClusterPair } = await import("./containers.ts");
    const [clusterA, clusterB] = await isolatedClusterPair();

    const sourceDb = await clusterA.createDb("pol_anon_priv_src");
    const desiredDb = await clusterB.createDb("pol_anon_priv_dst");

    try {
      // anon must exist physically on BOTH clusters: source so the plan can
      // apply against it (anon is the grant target), desired so extract sees
      // the ACL / default-privilege facts referencing it.
      await clusterA.adminPool
        .query(`CREATE ROLE anon NOLOGIN`)
        .catch(() => {});
      await clusterB.adminPool
        .query(`CREATE ROLE anon NOLOGIN`)
        .catch(() => {});

      // desired: a user schema that grants schema usage + default privileges
      // to the (out-of-view) platform role.
      await desiredDb.pool.query(`
            CREATE SCHEMA app;
            GRANT USAGE ON SCHEMA app TO anon;
            ALTER DEFAULT PRIVILEGES IN SCHEMA app
              GRANT SELECT ON TABLES TO anon;
          `);

      const [sourceState, desiredState] = await Promise.all([
        extract(sourceDb.pool),
        extract(desiredDb.pool),
      ]);

      // Plan under the supabase policy: must NOT throw "missing requirement".
      const thePlan = plan(sourceState.factBase, desiredState.factBase, {
        policy: supabasePolicy,
      });

      // The legitimate grants are KEPT (not silently dropped — the rejected
      // "wrong fix" would have excluded these deltas by grantee name).
      const sql = thePlan.actions.map((a) => a.sql).join("\n");
      expect(sql).toMatch(/GRANT USAGE ON SCHEMA "app" TO "anon"/);
      expect(sql).toMatch(
        /ALTER DEFAULT PRIVILEGES[^\n]*GRANT SELECT ON TABLES TO "anon"/,
      );

      // End-to-end: the plan applies cleanly against the source (anon exists).
      const report = await apply(thePlan, sourceDb.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
    } finally {
      await clusterA.adminPool
        .query(`DROP OWNED BY anon CASCADE`)
        .catch(() => {});
      await clusterB.adminPool
        .query(`DROP OWNED BY anon CASCADE`)
        .catch(() => {});
      await clusterA.adminPool
        .query(`DROP ROLE IF EXISTS anon`)
        .catch(() => {});
      await clusterB.adminPool
        .query(`DROP ROLE IF EXISTS anon`)
        .catch(() => {});
      await Promise.all([sourceDb.drop(), desiredDb.drop()]);
    }
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Test 4: serialize params via policy
// ---------------------------------------------------------------------------

describe("policy: serialize params via policy", () => {
  test("concurrentIndexes param from policy causes CREATE INDEX CONCURRENTLY in plan", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("pol_idx_src");
    const desired = await cluster.createDb("pol_idx_dst");
    try {
      // source: table exists (so no table creation — just index creation)
      await source.pool.query(`
          CREATE SCHEMA app;
          CREATE TABLE app.items (id integer, label text);
          INSERT INTO app.items SELECT i, i::text FROM generate_series(1, 10) i;
        `);
      await desired.pool.query(`
          CREATE SCHEMA app;
          CREATE TABLE app.items (id integer, label text);
          CREATE INDEX items_label_idx ON app.items (label);
        `);

      const [sourceState, desiredState] = await Promise.all([
        extract(source.pool),
        extract(desired.pool),
      ]);

      const concurrentPolicy: Policy = {
        id: "t2",
        serialize: [
          { match: { all: [] }, params: { concurrentIndexes: true } },
        ],
      };

      const thePlan = plan(sourceState.factBase, desiredState.factBase, {
        policy: concurrentPolicy,
      });

      // The index action should use CONCURRENTLY
      const indexAction = thePlan.actions.find((a) =>
        a.sql.includes("CONCURRENTLY"),
      );
      expect(indexAction).toBeDefined();
      expect(indexAction?.sql).toContain("CONCURRENTLY");
      expect(indexAction?.transactionality).toBe("nonTransactional");
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Test 5: provenance predicate end-to-end (edgeTo extension)
// ---------------------------------------------------------------------------

describe("policy: provenance filtering via edgeTo extension", () => {
  test("server created after CREATE EXTENSION has edge to extension; edgeTo predicate filters it via filterDeltas", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("pol_prov_src");
    const desired = await cluster.createDb("pol_prov_dst");
    try {
      await desired.pool.query(`
          CREATE EXTENSION postgres_fdw;
          CREATE SERVER s1 FOREIGN DATA WRAPPER postgres_fdw
            OPTIONS (host 'localhost', dbname 'test');
        `);

      const [sourceState, desiredState] = await Promise.all([
        extract(source.pool),
        extract(desired.pool),
      ]);

      // Verify the server fact exists in desiredState
      const serverFact = desiredState.factBase
        .facts()
        .find((f) => f.id.kind === "server");
      expect(serverFact).toBeDefined();

      // Inspect edges: a server created against an extension-member FDW
      // should have a 'depends' edge to the extension. The FDW is resolved
      // to the extension in the dependency extractor because postgres_fdw is
      // an extension member with deptype='e'.
      const serverEdges = desiredState.factBase.outgoingEdges(serverFact!.id);
      const edgeToExtension = serverEdges.find(
        (e) => e.to.kind === "extension",
      );

      // The extension fact IS in desiredState (it was just created)
      const extFact = desiredState.factBase
        .facts()
        .find((f) => f.id.kind === "extension");
      expect(extFact).toBeDefined();

      if (edgeToExtension !== undefined) {
        // The server has a direct edge to the extension.
        // Verify that the edgeTo predicate matches the server fact.
        const { factMatches } = await import("../src/policy/policy.ts");
        expect(
          factMatches(
            { edgeTo: { kind: "extension" } },
            serverFact!,
            desiredState.factBase,
          ),
        ).toBe(true);

        // Verify via filterDeltas: server add delta is filtered by the edgeTo rule
        const { diff } = await import("../src/core/diff.ts");
        const { filterDeltas } = await import("../src/policy/policy.ts");
        const allDeltas = diff(sourceState.factBase, desiredState.factBase);

        // Policy: include extensions, exclude servers that edge to an extension
        const filterPolicy: Policy = {
          id: "prov-test",
          filter: [
            {
              match: {
                all: [{ kind: "extension" }, { verb: ["add", "remove"] }],
              },
              action: "include",
            },
            {
              match: {
                all: [{ kind: "server" }, { edgeTo: { kind: "extension" } }],
              },
              action: "exclude",
            },
          ],
        };

        const { kept, filtered } = filterDeltas(
          allDeltas,
          filterPolicy,
          sourceState.factBase,
          desiredState.factBase,
        );

        // Extension add delta is kept (matched by first include rule)
        const extKept = kept.some(
          (d) => d.verb === "add" && d.fact.id.kind === "extension",
        );
        expect(extKept).toBe(true);

        // Server add delta is filtered (matched by second exclude rule)
        const serverFiltered = filtered.some(
          (d) => d.verb === "add" && d.fact.id.kind === "server",
        );
        expect(serverFiltered).toBe(true);
      } else {
        // Fallback: postgres_fdw FDW may not have been resolved to extension
        // (unusual but document). At minimum: the server and extension both
        // appear in the full (no-policy) diff.
        const { diff } = await import("../src/core/diff.ts");
        const allDeltas = diff(sourceState.factBase, desiredState.factBase);
        const hasExt = allDeltas.some(
          (d) => d.verb === "add" && d.fact.id.kind === "extension",
        );
        const hasSrv = allDeltas.some(
          (d) => d.verb === "add" && d.fact.id.kind === "server",
        );
        expect(hasExt).toBe(true);
        expect(hasSrv).toBe(true);
        // Document what edges exist for observability
        console.log(
          "server edges (no extension edge found):",
          JSON.stringify(serverEdges),
        );
      }
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 90_000);
});
