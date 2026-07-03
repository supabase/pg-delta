/**
 * §4: a function BODY change plans as a single in-place `CREATE OR REPLACE`
 * (PostgreSQL / pg_dump semantics — dependents, owner, and grants are
 * preserved), while a change `CREATE OR REPLACE` cannot express — a return-type
 * change — still demolishes (drop + recreate). The plan SHAPE is asserted here;
 * end-to-end convergence for both paths is proved by the corpus proof loop and
 * by the `provePlan` calls below. Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

async function planAndProve(fromSql: string, toSql: string): Promise<string[]> {
  const cluster = await sharedCluster();
  const src = await cluster.createDb("ralter_src");
  const dst = await cluster.createDb("ralter_dst");
  dbs.push(src, dst);
  await src.pool.query(fromSql);
  await dst.pool.query(toSql);
  const [srcState, dstState] = await Promise.all([
    extract(src.pool),
    extract(dst.pool),
  ]);
  const thePlan = plan(srcState.factBase, dstState.factBase);
  const clone = await src.clone();
  dbs.push(clone);
  const verdict = await provePlan(thePlan, clone.pool, dstState.factBase);
  expect(verdict.applyError).toBeUndefined();
  expect(verdict.driftDeltas).toEqual([]);
  expect(verdict.ok).toBe(true);
  return thePlan.actions.map((a) => a.sql);
}

describe("routine body change → single CREATE OR REPLACE", () => {
  test("a body-only change plans one CREATE OR REPLACE, no DROP / OWNER churn", async () => {
    const sql = await planAndProve(
      `CREATE SCHEMA s; CREATE FUNCTION s.f() RETURNS int LANGUAGE sql AS 'SELECT 1';`,
      `CREATE SCHEMA s; CREATE FUNCTION s.f() RETURNS int LANGUAGE sql AS 'SELECT 2';`,
    );
    expect(sql.filter((s) => s.startsWith("DROP FUNCTION"))).toEqual([]);
    expect(
      sql.filter((s) => /CREATE OR REPLACE FUNCTION/.test(s)),
    ).toHaveLength(1);
    expect(sql.filter((s) => /OWNER TO/.test(s))).toEqual([]);
  }, 120_000);

  test("a return-type change still demolishes (drop + recreate)", async () => {
    const sql = await planAndProve(
      `CREATE SCHEMA s; CREATE FUNCTION s.f() RETURNS int LANGUAGE sql AS 'SELECT 1';`,
      `CREATE SCHEMA s; CREATE FUNCTION s.f() RETURNS bigint LANGUAGE sql AS 'SELECT 1';`,
    );
    // pg-delta renders its own DROP with quoted identifiers; the recreate uses
    // the stored def (pg_get_functiondef output, unquoted where legal).
    expect(sql.some((s) => s.startsWith('DROP FUNCTION "s"."f"()'))).toBe(true);
    expect(sql.some((s) => /CREATE OR REPLACE FUNCTION s\.f\(\)/.test(s))).toBe(
      true,
    );
  }, 120_000);
});
