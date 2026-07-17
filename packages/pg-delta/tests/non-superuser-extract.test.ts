/**
 * Regression: `extract()` must succeed when connecting as a NON-superuser
 * login role, and produce a fact base IDENTICAL (by content-addressed
 * rootHash) to what a superuser extraction produces for the same database.
 *
 * RED at authoring time: the first failure a non-superuser `extract()` hits
 * is NOT the originally-suspected role security-label query — it's
 * `src/extract/foreign.ts`'s unconditional user-mapping query, which joins
 * `pg_user_mapping` (superuser/owner-only; can carry FDW credentials) with no
 * existence gate. Postgres checks table-level SELECT privilege on every
 * referenced relation regardless of matched row count, so this fires even
 * with zero foreign servers/mappings in the database:
 *
 *   error: permission denied for table pg_user_mapping
 *   code: "42501", routine: "aclcheck_error", file: "aclchk.c"
 *
 * Three superuser-only catalog reads are fixed to degrade gracefully instead:
 *  1. src/extract/foreign.ts — user mappings: probe `has_table_privilege`,
 *     fall back to the world-readable `pg_user_mappings` view (which NULLs
 *     `umoptions` for rows the caller isn't authorized on).
 *  2. src/extract/publications.ts — subscription `subconninfo`: probe
 *     `has_column_privilege`, fall back to the existing redaction placeholder.
 *  3. src/extract/security-labels.ts — role security labels: join `pg_roles`
 *     (world-readable) instead of `pg_authid` (superuser-only).
 *
 * A follow-up review finding (Codex P2 on the fallback in (1)): coalescing
 * `pg_user_mappings.umoptions` NULL to '{}' fabricates a "no options" fact
 * when the view is actually HIDING options from the caller — the second test
 * below ("hidden ... is skipped") pins that a hidden row is SKIPPED with a
 * diagnostic instead of being recorded with fabricated empty options.
 *
 * A further follow-up (Codex P1 on PR #338): skipping the fact isn't enough
 * on its own — if the OTHER side of a diff CAN see the same mapping, the
 * missing fact reads as an intentional add/remove and `plan()` would emit a
 * wrong CREATE/DROP USER MAPPING. RED (against the P2-only fix, no gate):
 * `plan(suResult.factBase, nsuResult.factBase)` (source sees it, desired
 * doesn't) silently produced a plan containing
 * `DROP USER MAPPING FOR PUBLIC SERVER "hidden_srv"` instead of refusing.
 * `plan()` now escalates the extraction-time diagnostic to fatal exactly when
 * a delta touches that mapping's subject (src/core/diagnostic.ts's
 * `USER_MAPPING_UNREADABLE`, gated in src/plan/plan.ts).
 *
 * Round 3 (Codex P1, comment 3601826173): `extract.ts` used to push
 * `ctx.factDiagnostics` onto the FactBase BEFORE the extension-handler block —
 * a handler contributing any fact/edge REASSIGNS `factBase` to a fresh
 * instance (buildFactBase never carries `.diagnostics` over), silently
 * orphaning the hidden-mapping diagnostic for exactly the integration-profile
 * (handler-bearing) callers the gate exists to protect. Fixed by moving the
 * push to after the handler block. See "an extension-handler rebuild" below.
 */
import { afterAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { USER_MAPPING_UNREADABLE } from "../src/core/diagnostic.ts";
import type { Fact } from "../src/core/fact.ts";
import { diff } from "../src/core/diff.ts";
import { extract, type ExtractResult } from "../src/extract/extract.ts";
import type { ExtensionHandler } from "../src/extract/handler.ts";
import { plan } from "../src/plan/plan.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
const pools: pg.Pool[] = [];
let roleName: string | undefined;
let granteeRoleName: string | undefined;

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end().catch(() => {})));
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
  const cluster = await sharedCluster();
  if (roleName) {
    await cluster.adminPool
      .query(`DROP ROLE IF EXISTS "${roleName}"`)
      .catch(() => {});
  }
  if (granteeRoleName) {
    await cluster.adminPool
      .query(`DROP ROLE IF EXISTS "${granteeRoleName}"`)
      .catch(() => {});
  }
});

const seedA = (granteeRole: string, nsuRole: string): string => `
  CREATE SCHEMA app;
  CREATE TYPE app.status AS ENUM ('active', 'inactive');
  CREATE SEQUENCE app.widget_seq;
  CREATE TABLE app.widget (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name text NOT NULL,
    status app.status NOT NULL DEFAULT 'active',
    legacy_id bigint DEFAULT nextval('app.widget_seq')
  );
  CREATE INDEX widget_name_idx ON app.widget (name);
  CREATE FUNCTION app.widget_count() RETURNS bigint LANGUAGE sql AS
    'SELECT count(*) FROM app.widget';
  CREATE VIEW app.widget_view AS SELECT id, name FROM app.widget;
  CREATE FUNCTION app.widget_touch() RETURNS trigger LANGUAGE plpgsql AS
    $$ BEGIN NEW.name := NEW.name; RETURN NEW; END $$;
  CREATE TRIGGER widget_touch BEFORE UPDATE ON app.widget
    FOR EACH ROW EXECUTE FUNCTION app.widget_touch();
  ALTER TABLE app.widget ENABLE ROW LEVEL SECURITY;
  CREATE POLICY widget_select ON app.widget FOR SELECT USING (true);
  GRANT SELECT ON app.widget TO "${granteeRole}";
  COMMENT ON TABLE app.widget IS 'widgets table';
  COMMENT ON FUNCTION app.widget_count() IS 'counts widgets';
  -- Foreign-data surface needing no contrib extension: exercises the
  -- pg_user_mapping fallback (view path). The mapping is FOR the extraction
  -- role itself (not PUBLIC) and it is GRANTed USAGE on the server, so the
  -- view's own authorization rule (mirrored by "options_known" in foreign.ts)
  -- provably shows this row is genuinely empty rather than hidden — the
  -- fallback must produce the identical fact with zero diagnostics, exactly
  -- like the privileged (catalog) path.
  CREATE FOREIGN DATA WRAPPER dummy_fdw;
  CREATE SERVER dummy_srv FOREIGN DATA WRAPPER dummy_fdw;
  CREATE USER MAPPING FOR "${nsuRole}" SERVER dummy_srv;
  GRANT USAGE ON FOREIGN SERVER dummy_srv TO "${nsuRole}";
`;

// Mutations applied on top of SEED_A (both dbA and dbB start from SEED_A;
// roles are cluster-global, so SEED_B must not re-declare app_reader).
const MUTATIONS_B = `
  ALTER TABLE app.widget ADD COLUMN description text;
  CREATE OR REPLACE FUNCTION app.widget_count() RETURNS bigint LANGUAGE sql AS
    'SELECT count(*) FROM app.widget WHERE status = ''active''';
  DROP INDEX app.widget_name_idx;
  CREATE TABLE app.gadget (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    widget_id bigint REFERENCES app.widget (id)
  );
`;

const factsOfKind = (result: ExtractResult, kind: Fact["id"]["kind"]): Fact[] =>
  result.factBase.facts().filter((f) => f.id.kind === kind);

describe("extract: non-superuser connection", () => {
  test("extract/diff/plan pipeline is identical for a superuser vs. non-superuser connection", async () => {
    const cluster = await sharedCluster();
    const dbA = await cluster.createDb("nsu_a");
    dbs.push(dbA);
    const dbB = await cluster.createDb("nsu_b");
    dbs.push(dbB);

    const ts = Date.now();
    roleName = `extract_nsu_${ts}`;
    granteeRoleName = `extract_nsu_reader_${ts}`;
    const password = "extractnsupwd";
    await cluster.adminPool.query(
      `CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}' NOSUPERUSER`,
    );
    await cluster.adminPool.query(`CREATE ROLE "${granteeRoleName}" NOLOGIN`);

    const seed = seedA(granteeRoleName, roleName);
    await dbA.pool.query(seed);
    await dbB.pool.query(seed);
    await dbB.pool.query(MUTATIONS_B);

    const uriA = dbA.uri.replace(
      "postgres://test:test@",
      `postgres://${roleName}:${password}@`,
    );
    const uriB = dbB.uri.replace(
      "postgres://test:test@",
      `postgres://${roleName}:${password}@`,
    );
    const nsuPoolA = new pg.Pool({ connectionString: uriA, max: 2 });
    nsuPoolA.on("error", () => {});
    pools.push(nsuPoolA);
    const nsuPoolB = new pg.Pool({ connectionString: uriB, max: 2 });
    nsuPoolB.on("error", () => {});
    pools.push(nsuPoolB);

    // Superuser extraction (baseline).
    const suResultA = await extract(dbA.pool);
    const suResultB = await extract(dbB.pool);
    const { factBase: suA } = suResultA;
    const { factBase: suB } = suResultB;

    // Non-superuser extraction — RED today: dies with "permission denied for
    // table pg_user_mapping" from the unconditional user-mapping query.
    const nsuResultA = await extract(nsuPoolA);
    const nsuResultB = await extract(nsuPoolB);
    const { factBase: nsuA } = nsuResultA;
    const { factBase: nsuB } = nsuResultB;

    // Identical content-addressed fingerprint for the same database, whoever
    // extracted it.
    expect(nsuA.rootHash).toBe(suA.rootHash);
    expect(nsuB.rootHash).toBe(suB.rootHash);

    // The diff between A and B is non-trivial either way.
    const suDeltas = diff(suA, suB);
    const nsuDeltas = diff(nsuA, nsuB);
    expect(suDeltas.length).toBeGreaterThan(0);
    expect(nsuDeltas.length).toBe(suDeltas.length);

    // plan() (source, desired) produces the same ordered SQL either way.
    const suPlan = plan(suA, suB);
    const nsuPlan = plan(nsuA, nsuB);
    const suSql = suPlan.actions.map((a) => a.sql);
    const nsuSql = nsuPlan.actions.map((a) => a.sql);
    expect(suSql.length).toBeGreaterThan(0);
    expect(nsuSql).toEqual(suSql);

    // fdw/server/userMapping facts appear in the non-superuser extraction and
    // match the superuser one (the fallback view path normalizes identically).
    for (const kind of ["fdw", "server", "userMapping"] as const) {
      const suFacts = factsOfKind(suResultA, kind);
      const nsuFacts = factsOfKind(nsuResultA, kind);
      expect(suFacts.length).toBeGreaterThan(0);
      expect(nsuFacts).toEqual(suFacts);
    }

    // The seeded mapping is provably visible to the fallback (granted USAGE on
    // the server), so no "hidden options" diagnostic fires on either side.
    expect(
      nsuResultA.diagnostics.some((d) => d.code === USER_MAPPING_UNREADABLE),
    ).toBe(false);
    expect(
      suResultA.diagnostics.some((d) => d.code === USER_MAPPING_UNREADABLE),
    ).toBe(false);
  }, 120_000);

  test("a pg_user_mappings row hidden from the caller is skipped with a diagnostic, never fabricated as empty options", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("nsu_hidden");
    dbs.push(db);

    const ts = Date.now();
    const role = `extract_nsu_hidden_${ts}`;
    const password = "extractnsuhiddenpwd";
    await cluster.adminPool.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER`,
    );

    // A PUBLIC mapping WITH options, admin-seeded. The extraction role is
    // granted no membership/USAGE on the server, so `pg_user_mappings` hides
    // umoptions from it — this row must be SKIPPED, not recorded with
    // fabricated empty options.
    await db.pool.query(`
      CREATE FOREIGN DATA WRAPPER hidden_fdw;
      CREATE SERVER hidden_srv FOREIGN DATA WRAPPER hidden_fdw;
      CREATE USER MAPPING FOR PUBLIC SERVER hidden_srv OPTIONS ("user" 'hidden_user');
    `);

    const uri = db.uri.replace(
      "postgres://test:test@",
      `postgres://${role}:${password}@`,
    );
    const pool = new pg.Pool({ connectionString: uri, max: 2 });
    pool.on("error", () => {});
    pools.push(pool);

    const suResult = await extract(db.pool);
    const nsuResult = await extract(pool);

    const hasHiddenSrvMapping = (result: ExtractResult): boolean =>
      factsOfKind(result, "userMapping").some(
        (f) => (f.id as { server: string }).server === "hidden_srv",
      );

    // RED (against the naive fallback that coalesces NULL umoptions to '{}'):
    // the non-superuser extraction ALSO has the fact, with fabricated empty
    // options — indistinguishable from a genuinely-empty mapping.
    expect(hasHiddenSrvMapping(suResult)).toBe(true);
    expect(hasHiddenSrvMapping(nsuResult)).toBe(false);

    expect(
      nsuResult.diagnostics.some(
        (d) =>
          d.code === USER_MAPPING_UNREADABLE &&
          d.message.includes("hidden_srv"),
      ),
    ).toBe(true);
    expect(
      suResult.diagnostics.some((d) => d.code === USER_MAPPING_UNREADABLE),
    ).toBe(false);

    // The superuser side sees the mapping; the non-superuser side skipped it
    // as unreadable. Diffing the two must NOT read the missing fact as an
    // intentional drop or create — plan() must refuse both directions.
    // RED (against the P2-only fix, no gate): this silently produced a plan
    // containing `DROP USER MAPPING FOR PUBLIC SERVER "hidden_srv"` instead.
    expect(() => plan(suResult.factBase, nsuResult.factBase)).toThrow(
      /user mappings is unknown on one side/,
    );
    expect(() => plan(suResult.factBase, nsuResult.factBase)).toThrow(
      /hidden_srv/,
    );
    // reverse direction (would-be CREATE) must also refuse.
    expect(() => plan(nsuResult.factBase, suResult.factBase)).toThrow(
      /user mappings is unknown on one side/,
    );

    await cluster.adminPool
      .query(`DROP ROLE IF EXISTS "${role}"`)
      .catch(() => {});
  }, 120_000);

  test("a hidden-mapping diagnostic survives an extension-handler rebuild", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("nsu_handler");
    dbs.push(db);

    const ts = Date.now();
    const role = `extract_nsu_handler_${ts}`;
    const password = "extractnsuhandlerpwd";
    await cluster.adminPool.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER`,
    );

    // Same hidden-mapping shape as above: a PUBLIC mapping WITH options that
    // this role has no usage/membership to see.
    await db.pool.query(`
      CREATE FOREIGN DATA WRAPPER handler_fdw;
      CREATE SERVER handler_srv FOREIGN DATA WRAPPER handler_fdw;
      CREATE USER MAPPING FOR PUBLIC SERVER handler_srv OPTIONS ("user" 'handler_hidden_user');
    `);

    const uri = db.uri.replace(
      "postgres://test:test@",
      `postgres://${role}:${password}@`,
    );
    const pool = new pg.Pool({ connectionString: uri, max: 2 });
    pool.on("error", () => {});
    pools.push(pool);

    // The lightest possible handler vehicle (no Supabase image / pg_partman
    // needed): a synthetic capture() that always contributes one fact, which
    // forces extract.ts's handler-triggered FactBase REBUILD path.
    const dummyHandler: ExtensionHandler = {
      extension: "no_such_extension",
      capture: async () => ({
        facts: [
          { id: { kind: "schema", name: "handler_dummy_schema" }, payload: {} },
        ],
        edges: [],
      }),
    };

    const nsuResult = await extract(pool, { handlers: [dummyHandler] });

    // RED (before the fix): the handler rebuild discarded factBase.diagnostics
    // pushed before it, so the hidden-mapping diagnostic never made it onto
    // the (rebuilt) fact base — plan()'s gate would see nothing to escalate.
    expect(
      nsuResult.factBase.diagnostics.some(
        (d) =>
          d.code === USER_MAPPING_UNREADABLE &&
          d.message.includes("handler_srv"),
      ),
    ).toBe(true);
    expect(
      nsuResult.diagnostics.some(
        (d) =>
          d.code === USER_MAPPING_UNREADABLE &&
          d.message.includes("handler_srv"),
      ),
    ).toBe(true);

    await cluster.adminPool
      .query(`DROP ROLE IF EXISTS "${role}"`)
      .catch(() => {});
  }, 120_000);
});
