/**
 * Bug 1, Phase 2 (cosmetic): policy drops are never folded into the table drop
 * (suppressible:false, for teardown-cycle correctness), which would otherwise
 * leave a redundant explicit DROP POLICY whenever a table with policies is
 * dropped. The elideCascadeSubsumedPolicyDrops compaction trims that redundant
 * statement — but ONLY when the policy is not load-bearing. This pins both:
 *   - a self-referencing policy on a dropped table → DROP POLICY elided (the
 *     implicit DROP TABLE cascade removes it);
 *   - a policy whose USING references a SEPARATELY-dropped view → DROP POLICY
 *     KEPT and ordered before the view drop (eliding it would be unappliable).
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { sharedCluster } from "./containers.ts";

async function teardownSql(setupSql: string): Promise<string[]> {
  const cluster = await sharedCluster();
  const full = await cluster.createDb("polcompact_full");
  const empty = await cluster.createDb("polcompact_empty");
  try {
    await full.pool.query(setupSql);
    const [from, to] = [await extract(full.pool), await extract(empty.pool)];
    return plan(from.factBase, to.factBase).actions.map((a) => a.sql);
  } finally {
    await Promise.all([full.drop(), empty.drop()]);
  }
}

describe("policy drop compaction", () => {
  test("a self-referencing policy's drop is elided when its table is dropped", async () => {
    const sql = await teardownSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.t (id integer PRIMARY KEY, owner_id integer);
      ALTER TABLE app.t ENABLE ROW LEVEL SECURITY;
      CREATE POLICY p ON app.t FOR SELECT TO public USING (owner_id = 1);
    `);
    // the table cascade removes the policy → no explicit DROP POLICY
    expect(sql.some((s) => /DROP POLICY/.test(s))).toBe(false);
    expect(sql.some((s) => /DROP TABLE "app"\."t"/.test(s))).toBe(true);
  }, 60_000);

  test("a policy referencing a separately-dropped view keeps its explicit drop, ordered first", async () => {
    const sql = await teardownSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.accounts (id integer PRIMARY KEY, active boolean NOT NULL);
      CREATE VIEW app.active_accounts AS SELECT id FROM app.accounts WHERE active;
      ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY account_access ON app.accounts FOR SELECT TO public
        USING (id IN (SELECT id FROM app.active_accounts));
    `);
    const dropPolicy = sql.findIndex((s) => /DROP POLICY/.test(s));
    const dropView = sql.findIndex((s) => /DROP VIEW/.test(s));
    const dropTable = sql.findIndex((s) => /DROP TABLE/.test(s));
    expect(dropPolicy).toBeGreaterThanOrEqual(0); // kept (load-bearing)
    expect(dropPolicy).toBeLessThan(dropView); // before the view it references
    expect(dropView).toBeLessThan(dropTable); // view before its table
  }, 60_000);
});
