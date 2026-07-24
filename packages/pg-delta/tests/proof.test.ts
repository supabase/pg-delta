/**
 * Proof-harness safety checks (stage 3 / §3.7): the proof loop turns
 * declared safety metadata into verified claims. These tests inject a
 * mis-declaring action into a real plan and assert the proof catches it —
 * the safety net that protects every rule.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan, type Plan, type ProjectionAudit } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import type { Policy } from "../src/policy/policy.ts";
import { sharedCluster } from "./containers.ts";

function installSuspiciousAudit(thePlan: Plan): ProjectionAudit {
  const id = { kind: "schema" as const, name: "audit_hidden" };
  const audit: ProjectionAudit = {
    entries: [
      {
        delta: { verb: "add", fact: { id, payload: {} } },
        subject: { kind: "fact", id },
        suppressions: [
          {
            side: "desired",
            stage: "policyScopeRule",
            reasonCode: "policy:test:hidden",
            classification: "suspicious",
          },
        ],
        classification: "suspicious",
      },
    ],
    summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
  };
  thePlan.projectionAudit = audit;
  return audit;
}

function expectSuspiciousAuditOnEarlyReturn(
  verdict: Awaited<ReturnType<typeof provePlan>>,
  audit: ProjectionAudit,
): void {
  expect(verdict.projectionAuditStatus).toBe("available");
  expect(verdict.projectionAudit).toEqual(audit);
  expect(verdict.strictAuditFailure).toBe("suspicious");
}

describe("proof: rewrite observation", () => {
  test("an undeclared in-place rewrite (relfilenode change) fails the proof", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_rw_src");
    const desired = await cluster.createDb("proof_rw_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, n text);
        INSERT INTO app.t SELECT i, i::text FROM generate_series(1, 5) i;
      `);
      // a column TYPE change rewrites the table; the rule correctly declares
      // rewriteRisk:true, so a correct plan PASSES
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id bigint, n text);
      `);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const honest = plan(s.factBase, d.factBase);
      const typeAction = honest.actions.find((a) =>
        a.sql.includes("TYPE bigint"),
      );
      expect(typeAction?.rewriteRisk).toBe(true);

      // simulate a BUGGY rule: strip the rewriteRisk declaration. The proof
      // must now catch the relfilenode change that nobody warned about.
      const buggy = structuredClone(honest);
      for (const a of buggy.actions) a.rewriteRisk = false;
      const verdict = await provePlan(buggy, source.pool, d.factBase);
      expect(verdict.rewriteViolations.length).toBeGreaterThan(0);
      // `.table` is structured { schema, name } — unambiguous (identifiers can
      // contain dots) and rendered with render.ts `rel()` for display.
      expect(verdict.rewriteViolations[0]?.table).toEqual({
        schema: "app",
        name: "t",
      });
      expect(verdict.ok).toBe(false);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("a declared rewrite (rewriteRisk:true) is NOT a violation", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_rw_ok_src");
    const desired = await cluster.createDb("proof_rw_ok_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer);
        INSERT INTO app.t SELECT generate_series(1, 5);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id bigint);
      `);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const verdict = await provePlan(
        plan(s.factBase, d.factBase),
        source.pool,
        d.factBase,
      );
      // relfilenode changed, but the rule declared it — no violation, and
      // the rows survived the type cast
      expect(verdict.rewriteViolations).toHaveLength(0);
      expect(verdict.dataViolations).toHaveLength(0);
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});

describe("proof: auto-seed data preservation", () => {
  test("auto-seed makes an undeclared row loss on a kept table visible", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_seed_src");
    const desired = await cluster.createDb("proof_seed_dst");
    try {
      // identical schema both sides: a correct plan is empty. We inject a
      // TRUNCATE action with no `destroys` (so the table is "kept"), modeling
      // a rule that silently discards rows — auto-seed must surface it.
      const ddl = `CREATE SCHEMA app; CREATE TABLE app.t (id integer DEFAULT 1);`;
      await source.pool.query(ddl);
      await desired.pool.query(ddl);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const thePlan = plan(s.factBase, d.factBase);
      thePlan.actions.push({
        sql: `TRUNCATE app.t`,
        verb: "alter",
        produces: [],
        consumes: [{ kind: "table", schema: "app", name: "t" }],
        destroys: [],
        releases: [],
        transactionality: "transactional",
        lockClass: "accessExclusive",
        newSegmentBefore: false,
        dataLoss: "none", // the lie the proof must catch
        rewriteRisk: false,
      });
      // without auto-seed the kept table is empty, so the loss is invisible
      const blind = await provePlan(
        structuredClone(thePlan),
        source.pool,
        d.factBase,
        {
          autoSeed: false,
        },
      );
      expect(blind.dataViolations).toHaveLength(0);
      // re-clone-equivalent: fresh dbs so the first run's TRUNCATE doesn't taint
      const source2 = await cluster.createDb("proof_seed_src2");
      try {
        await source2.pool.query(ddl);
        const s2 = await extract(source2.pool);
        const thePlan2 = plan(s2.factBase, d.factBase);
        thePlan2.actions.push({
          sql: `TRUNCATE app.t`,
          verb: "alter",
          produces: [],
          consumes: [{ kind: "table", schema: "app", name: "t" }],
          destroys: [],
          releases: [],
          transactionality: "transactional",
          lockClass: "accessExclusive",
          newSegmentBefore: false,
          dataLoss: "none",
          rewriteRisk: false,
        });
        const seeded = await provePlan(thePlan2, source2.pool, d.factBase, {
          autoSeed: true,
        });
        expect(seeded.dataViolations.length).toBeGreaterThan(0);
        // `.table` is structured { schema, name }.
        expect(seeded.dataViolations[0]?.table).toEqual({
          schema: "app",
          name: "t",
        });
      } finally {
        await source2.drop();
      }
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});

describe("proof: projection audit on early returns", () => {
  test("seed data side-effect return retains audit status, data, and strict failure", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_audit_seed_data");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.victim (id integer);
        INSERT INTO app.victim VALUES (1);
        CREATE TABLE app.seed_mutator (id integer);
        CREATE FUNCTION app.delete_victim() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN DELETE FROM app.victim; RETURN NEW; END $$;
        CREATE TRIGGER delete_victim_after AFTER INSERT ON app.seed_mutator
          FOR EACH ROW EXECUTE FUNCTION app.delete_victim();
      `);
      const { factBase } = await extract(source.pool);
      const thePlan = plan(factBase, factBase);
      const audit = installSuspiciousAudit(thePlan);

      const verdict = await provePlan(thePlan, source.pool, factBase, {
        autoSeed: true,
        strictAudit: true,
      });

      expect(verdict.seedSideEffects).toContainEqual({
        table: { schema: "app", name: "victim" },
        before: 1,
        after: 0,
      });
      expectSuspiciousAuditOnEarlyReturn(verdict, audit);
    } finally {
      await source.drop();
    }
  }, 60_000);

  test("seed state-change return retains audit status, data, and strict failure", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_audit_seed_state");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.victim (id integer);
        INSERT INTO app.victim VALUES (1);
        CREATE TABLE app.seed_mutator (id integer);
        CREATE FUNCTION app.enable_victim_rls() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            ALTER TABLE app.victim ENABLE ROW LEVEL SECURITY;
            RETURN NEW;
          END $$;
        CREATE TRIGGER enable_victim_rls_after AFTER INSERT ON app.seed_mutator
          FOR EACH ROW EXECUTE FUNCTION app.enable_victim_rls();
      `);
      const { factBase } = await extract(source.pool);
      const thePlan = plan(factBase, factBase);
      const audit = installSuspiciousAudit(thePlan);

      const verdict = await provePlan(thePlan, source.pool, factBase, {
        autoSeed: true,
        strictAudit: true,
      });

      expect(verdict.seedStateViolation).toMatchObject({
        expectedFingerprint: factBase.rootHash,
        actualFingerprint: expect.any(String),
      });
      expectSuspiciousAuditOnEarlyReturn(verdict, audit);
    } finally {
      await source.drop();
    }
  }, 60_000);

  test("apply-failure return retains audit status, data, and strict failure", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_audit_apply_failure");
    try {
      await source.pool.query(
        `CREATE SCHEMA app; CREATE TABLE app.t (id integer)`,
      );
      const { factBase } = await extract(source.pool);
      const thePlan = plan(factBase, factBase);
      thePlan.actions.push({
        sql: "SELECT * FROM app.definitely_missing",
        verb: "alter",
        produces: [],
        consumes: [],
        destroys: [],
        releases: [],
        transactionality: "transactional",
        lockClass: "none",
        newSegmentBefore: false,
        dataLoss: "none",
        rewriteRisk: false,
      });
      const audit = installSuspiciousAudit(thePlan);

      const verdict = await provePlan(thePlan, source.pool, factBase, {
        strictAudit: true,
      });

      expect(verdict.applyError).toMatchObject({ actionIndex: 0 });
      expectSuspiciousAuditOnEarlyReturn(verdict, audit);
    } finally {
      await source.drop();
    }
  }, 60_000);
});

describe("proof: projection audit", () => {
  test("surfaces suspicious managed-view suppression and optionally blocks it", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_audit_src");
    const desired = await cluster.createDb("proof_audit_dst");
    try {
      await source.pool.query(`CREATE SCHEMA app`);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.ignored ();
      `);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const policy: Policy = {
        id: "generic",
        filter: [{ match: { kind: "table" }, action: "exclude" }],
      };
      const thePlan = plan(s.factBase, d.factBase, { policy });
      expect(thePlan.projectionAudit).toBeDefined();

      const informational = await provePlan(
        structuredClone(thePlan),
        source.pool,
        d.factBase,
      );
      expect(informational.ok).toBe(true);
      expect(informational.projectionAuditStatus).toBe("available");
      expect(informational.projectionAudit).toEqual(thePlan.projectionAudit!);
      expect(informational.projectionAudit.summary.suspicious).toBeGreaterThan(
        0,
      );
      expect(informational.projectionAudit.entries).toContainEqual(
        expect.objectContaining({
          delta: expect.objectContaining({
            verb: "add",
            fact: expect.objectContaining({
              id: { kind: "table", schema: "app", name: "ignored" },
            }),
          }),
          classification: "suspicious",
        }),
      );

      const strict = await provePlan(thePlan, source.pool, d.factBase, {
        strictAudit: true,
      });
      expect(strict.ok).toBe(false);
      expect(strict.strictAuditFailure).toBe("suspicious");
      expect(strict.driftDeltas).toHaveLength(0);
      expect(strict.dataViolations).toHaveLength(0);
      expect(strict.rewriteViolations).toHaveLength(0);

      const acknowledgedPlan = structuredClone(thePlan);
      const auditTotal = acknowledgedPlan.projectionAudit!.summary.total;
      acknowledgedPlan.projectionAudit = {
        entries: acknowledgedPlan.projectionAudit!.entries.map((entry) => ({
          ...entry,
          classification: "acknowledged",
          suppressions: entry.suppressions.map((suppression) => ({
            ...suppression,
            classification: "acknowledged",
          })),
        })),
        summary: {
          total: auditTotal,
          suspicious: 0,
          acknowledged: auditTotal,
          baseline: auditTotal,
        },
      };
      const acknowledged = await provePlan(
        acknowledgedPlan,
        source.pool,
        d.factBase,
        { strictAudit: true },
      );
      expect(acknowledged.ok).toBe(true);
      expect(acknowledged.projectionAudit.summary).toMatchObject({
        suspicious: 0,
        acknowledged: auditTotal,
        baseline: 0,
      });

      const inconsistentPlan = structuredClone(thePlan);
      inconsistentPlan.projectionAudit!.summary = {
        total: 0,
        suspicious: 0,
        acknowledged: 0,
        baseline: 0,
      };
      const inconsistent = await provePlan(
        inconsistentPlan,
        source.pool,
        d.factBase,
        { strictAudit: true },
      );
      expect(inconsistent.ok).toBe(false);
      expect(inconsistent.strictAuditFailure).toBe("suspicious");
      expect(inconsistent.projectionAudit.summary.suspicious).toBeGreaterThan(
        0,
      );

      const legacyPlan = structuredClone(thePlan);
      delete legacyPlan.projectionAudit;
      const legacy = await provePlan(legacyPlan, source.pool, d.factBase, {
        strictAudit: true,
      });
      expect(legacy.ok).toBe(false);
      expect(legacy.projectionAuditStatus).toBe("unavailable");
      expect(legacy.strictAuditFailure).toBe("unavailable");
      expect(legacy.projectionAudit).toEqual({
        entries: [],
        summary: { total: 0, suspicious: 0, acknowledged: 0, baseline: 0 },
      });
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});
