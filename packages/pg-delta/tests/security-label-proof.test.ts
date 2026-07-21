/**
 * Security-label end-to-end proof (COVERAGE.md). Docker required: a
 * `postgres:<major>-alpine` image with the `dummy_seclabel` test module
 * compiled in and preloaded (tests/dummy-seclabel.Dockerfile,
 * tests/containers.ts::seclabelCluster).
 *
 * Extraction + rule rendering for SECURITY LABEL are unit-tested
 * (src/plan/security-label.test.ts). This proves the full create / change /
 * drop cycle APPLIES to a real database and re-extracts identically — the gap
 * COVERAGE.md flagged as environment-gated. The `dummy` provider stores labels
 * VERBATIM (no normalization → clean apply → re-extract → compare), unlike a
 * real provider that rewrites labels against its own grammar; it does validate
 * against a fixed vocabulary, so the labels below are drawn from its allowed
 * set: unclassified / classified / secret / top secret.
 *
 * Skips itself when PGDELTA_SKIP_DUMMY_SECLABEL_BUILD is set (sandboxes that
 * cannot build the image).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import {
  seclabelCluster,
  skipSeclabelProof,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

/** Apply `fromSql` / `toSql` to two fresh DBs, plan from→to, and prove it on a
 *  clone of the `from` side (the real ordering + apply + re-extract check). */
async function proveTransition(
  name: string,
  fromSql: string,
  toSql: string,
): Promise<Awaited<ReturnType<typeof provePlan>> & { actions: number }> {
  const cluster = await seclabelCluster();
  const source = await cluster.createDb(`sl_${name}_src`);
  const desired = await cluster.createDb(`sl_${name}_dst`);
  dbs.push(source, desired);
  await source.pool.query(fromSql);
  await desired.pool.query(toSql);
  const sourceState = await extract(source.pool);
  const desiredState = await extract(desired.pool);
  const thePlan = plan(sourceState.factBase, desiredState.factBase);
  const clone = await source.clone();
  dbs.push(clone);
  const verdict = await provePlan(thePlan, clone.pool, desiredState.factBase);
  return { ...verdict, actions: thePlan.actions.length };
}

const BASE = `CREATE TABLE public.docs (id integer PRIMARY KEY, body text);`;
const tableLabel = (lbl: string) =>
  `${BASE}\nSECURITY LABEL FOR 'dummy' ON TABLE public.docs IS '${lbl}';`;

describe.skipIf(skipSeclabelProof)("security-label end-to-end proof", () => {
  test("create a security label on a table converges and applies", async () => {
    const v = await proveTransition("create", BASE, tableLabel("classified"));
    expect(v.actions).toBeGreaterThan(0); // a SECURITY LABEL action was planned
    expect(v.applyError).toBeUndefined();
    expect(v.driftDeltas).toEqual([]);
    expect(v.ok).toBe(true);
  }, 240_000);

  test("change a security label in place converges", async () => {
    const v = await proveTransition(
      "change",
      tableLabel("secret"),
      tableLabel("top secret"),
    );
    expect(v.applyError).toBeUndefined();
    expect(v.driftDeltas).toEqual([]);
    expect(v.ok).toBe(true);
  }, 240_000);

  test("drop a security label converges (IS NULL)", async () => {
    const v = await proveTransition("drop", tableLabel("classified"), BASE);
    expect(v.applyError).toBeUndefined();
    expect(v.driftDeltas).toEqual([]);
    expect(v.ok).toBe(true);
  }, 240_000);

  test("a column security label round-trips (objsubid path)", async () => {
    const v = await proveTransition(
      "column",
      BASE,
      `${BASE}\nSECURITY LABEL FOR 'dummy' ON COLUMN public.docs.body IS 'secret';`,
    );
    expect(v.applyError).toBeUndefined();
    expect(v.driftDeltas).toEqual([]);
    expect(v.ok).toBe(true);
  }, 240_000);

  // One create-the-label transition per SECURITY-LABEL-supported modeled target
  // kind (REVIEW_HANDOFF.md P1). The label must be EXTRACTED — otherwise both
  // sides extract identically and the proof passes vacuously, which is exactly
  // the silent-miss the rewrite must avoid. So we assert a SECURITY LABEL action
  // was actually planned (`actions > 0`) AND it converges. event-trigger,
  // publication, and subscription labels were the missing kinds.
  const KIND_CASES: Array<{ name: string; setup: string; on: string }> = [
    { name: "schema", setup: `CREATE SCHEMA sl;`, on: `SCHEMA sl` },
    {
      name: "view",
      setup: `CREATE VIEW public.v AS SELECT 1 AS x;`,
      on: `VIEW public.v`,
    },
    {
      name: "matview",
      setup: `CREATE MATERIALIZED VIEW public.mv AS SELECT 1 AS x;`,
      on: `MATERIALIZED VIEW public.mv`,
    },
    {
      name: "sequence",
      setup: `CREATE SEQUENCE public.s;`,
      on: `SEQUENCE public.s`,
    },
    {
      name: "domain",
      setup: `CREATE DOMAIN public.d AS integer;`,
      on: `DOMAIN public.d`,
    },
    {
      name: "type",
      setup: `CREATE TYPE public.ty AS (a integer);`,
      on: `TYPE public.ty`,
    },
    {
      // enum and composite are both the engine's `type` kind but extract via
      // different catalog paths (pg_enum vs pg_attribute); the old engine's
      // security-label-operations suite exercised an enum TYPE label explicitly.
      name: "enum-type",
      setup: `CREATE TYPE public.status AS ENUM ('active', 'inactive');`,
      on: `TYPE public.status`,
    },
    {
      name: "function",
      setup: `CREATE FUNCTION public.f() RETURNS integer LANGUAGE sql AS 'SELECT 1';`,
      on: `FUNCTION public.f()`,
    },
    {
      name: "procedure",
      setup: `CREATE PROCEDURE public.p() LANGUAGE sql AS $$ SELECT 1 $$;`,
      on: `PROCEDURE public.p()`,
    },
    {
      name: "aggregate",
      setup: `CREATE AGGREGATE public.agg(integer) (SFUNC = int4larger, STYPE = integer);`,
      on: `AGGREGATE public.agg(integer)`,
    },
    {
      name: "event-trigger",
      setup: `CREATE FUNCTION public.etf() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN END $$;\nCREATE EVENT TRIGGER et ON ddl_command_end EXECUTE FUNCTION public.etf();`,
      on: `EVENT TRIGGER et`,
    },
    {
      name: "publication",
      setup: `CREATE PUBLICATION pub;`,
      on: `PUBLICATION pub`,
    },
  ];

  for (const c of KIND_CASES) {
    test(`a ${c.name} security label is extracted, planned, and converges`, async () => {
      const v = await proveTransition(
        `kind_${c.name.replace(/-/g, "_")}`,
        c.setup,
        `${c.setup}\nSECURITY LABEL FOR 'dummy' ON ${c.on} IS 'secret';`,
      );
      expect(v.actions).toBeGreaterThan(0); // not silently dropped
      expect(v.applyError).toBeUndefined();
      expect(v.driftDeltas).toEqual([]);
      expect(v.ok).toBe(true);
    }, 240_000);
  }

  test("a role security label is extracted, planned, and converges (shared catalog)", async () => {
    // Roles and their labels live in the SHARED catalog (pg_shseclabel), so they
    // are cluster-wide, not per-database. proveTransition cannot be reused: it
    // extracts both sides AFTER applying the desired SQL, but a cluster-global
    // label set on `desired` is immediately visible from `source` too, making
    // the diff vacuous. So capture the source factBase BEFORE the label exists.
    const cluster = await seclabelCluster();
    const source = await cluster.createDb("sl_role_src");
    const desired = await cluster.createDb("sl_role_dst");
    dbs.push(source, desired);
    const role = "tier7_sl_role";
    const ensureRole = `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role};
      END IF; END $$;`;
    await source.pool.query(ensureRole);
    await desired.pool.query(ensureRole);
    const sourceState = await extract(source.pool);
    await desired.pool.query(
      `SECURITY LABEL FOR 'dummy' ON ROLE ${role} IS 'classified';`,
    );
    const desiredState = await extract(desired.pool);
    const thePlan = plan(sourceState.factBase, desiredState.factBase);
    expect(thePlan.actions.length).toBeGreaterThan(0); // label not dropped
    const clone = await source.clone();
    dbs.push(clone);
    const v = await provePlan(thePlan, clone.pool, desiredState.factBase);
    expect(v.applyError).toBeUndefined();
    expect(v.driftDeltas).toEqual([]);
    expect(v.ok).toBe(true);
  }, 240_000);

  test("a label on an unsupported target is reported, never silently dropped", async () => {
    const cluster = await seclabelCluster();
    const db = await cluster.createDb("sl_unresolved");
    dbs.push(db);
    // LANGUAGE is a valid SECURITY LABEL target but an unmodeled engine kind, so
    // the label cannot resolve to a managed stable id. It must surface as a
    // diagnostic, not vanish (a vanished label lets the proof pass vacuously).
    await db.pool.query(
      `SECURITY LABEL FOR 'dummy' ON LANGUAGE plpgsql IS 'secret';`,
    );
    const { diagnostics } = await extract(db.pool);
    expect(
      diagnostics.some((d) => d.code === "unresolved_security_label"),
    ).toBe(true);
  }, 240_000);

  test("a label on a VIEW COLUMN is reported, never a crash on a missing column parent", async () => {
    const cluster = await seclabelCluster();
    const db = await cluster.createDb("sl_viewcol");
    dbs.push(db);
    // View/matview columns produce NO column facts (relations.ts extracts columns
    // only for relkinds r/p/f), but the label extractor pushed a securityLabel
    // parented on that missing column fact for any objsubid > 0 → buildFactBase
    // threw "references missing parent …column…", crashing extraction outright.
    await db.pool.query(`
      CREATE VIEW public.v AS SELECT 1 AS x;
      SECURITY LABEL FOR 'dummy' ON COLUMN public.v.x IS 'secret';
    `);
    // RED before the fix: extract() throws instead of returning. After: the
    // view-column label surfaces as a diagnostic (strict mode blocks, default
    // warns), never a fact on a missing parent.
    const { diagnostics } = await extract(db.pool);
    expect(
      diagnostics.some((d) => d.code === "unresolved_security_label"),
    ).toBe(true);
  }, 240_000);

  test("a label on an UNMODELED pg_type kind surfaces as unresolved (not a mis-diagnosed orphan)", async () => {
    const cluster = await seclabelCluster();
    const db = await cluster.createDb("sl_unmodeled_type");
    dbs.push(db);
    // A table's ROW TYPE is a pg_type row (typtype='c') whose backing pg_class
    // relkind is 'r', so extractTypes does NOT model it (only STANDALONE
    // composites with relkind='c' are). The pg_type seclabel resolver mapped
    // EVERY non-domain pg_type row to a `type` fact, so this label produced a
    // satellite parented on a type fact that never existed.
    await db.pool.query(`
      CREATE TABLE public.rowty (a integer, b text);
      SECURITY LABEL FOR 'dummy' ON TYPE public.rowty IS 'secret';
    `);
    // RED before the fix: the orphaned satellite was swept by
    // pruneOrphanedSatellites into an `orphaned_satellite` diagnostic (severity
    // `info` — NOT blocked by --strict-coverage), so the unmodeled-target label
    // slipped through the strict gate: `unresolved_security_label` was absent.
    // (Without the pruneOrphanedSatellites crash guard it would throw
    // missing-parent outright.) GREEN: the resolver skips unmodeled type kinds,
    // so the label flows to the intended `unresolved_security_label` warning.
    const { diagnostics } = await extract(db.pool);
    expect(
      diagnostics.some((d) => d.code === "unresolved_security_label"),
    ).toBe(true);
    expect(diagnostics.some((d) => d.code === "orphaned_satellite")).toBe(
      false,
    );
  }, 240_000);
});
