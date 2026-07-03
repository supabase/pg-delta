/**
 * Extension-member ACL/comment/seclabel customizations must be diffed and
 * reproduced. An extension member (e.g. an hstore function, a pg_net function)
 * is created by CREATE EXTENSION, so pg-delta never independently CREATEs/DROPs
 * it — but a GRANT / COMMENT / SECURITY LABEL layered on it afterward is USER
 * state (Supabase grants net.http_get to anon/authenticated/…), and losing it
 * makes the managed view diverge from reality. The member OBJECT stays
 * reference-only (never a create/drop/alter action); only its satellite facts
 * that differ from the extension's install-time state are diffed. Docker
 * required.
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

describe("extension-member ACL customizations are diffed", () => {
  test("a GRANT on an extension-member function is planned + converges", async () => {
    const cluster = await sharedCluster();
    await cluster.adminPool
      .query(`CREATE ROLE extacl_grantee NOLOGIN`)
      .catch(() => {});
    const src = await cluster.createDb("extacl_src");
    const dst = await cluster.createDb("extacl_dst");
    dbs.push(src, dst);
    // both sides install hstore; only dst grants a member function to the role.
    await src.pool.query(`CREATE EXTENSION hstore SCHEMA public;`);
    await dst.pool.query(
      `CREATE EXTENSION hstore SCHEMA public;
       GRANT EXECUTE ON FUNCTION hstore(text, text) TO extacl_grantee;`,
    );
    const [s, d] = await Promise.all([extract(src.pool), extract(dst.pool)]);
    const thePlan = plan(s.factBase, d.factBase);
    const sql = thePlan.actions.map((a) => a.sql);

    // The member function is never itself created/dropped (extension-managed).
    expect(sql.some((x) => /CREATE (OR REPLACE )?FUNCTION.*hstore/.test(x))).toBe(
      false,
    );
    expect(sql.some((x) => /DROP FUNCTION.*hstore/.test(x))).toBe(false);
    // But the GRANT it carries IS planned.
    expect(
      sql.some((x) => x.includes("GRANT") && x.includes("extacl_grantee")),
    ).toBe(true);

    // …and the plan converges against a real clone of the source.
    const clone = await src.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, d.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});
