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
    expect(
      sql.some((x) => /CREATE (OR REPLACE )?FUNCTION.*hstore/.test(x)),
    ).toBe(false);
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

  test("a COMMENT on an extension-member function is planned + converges", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("extcmt_src");
    const dst = await cluster.createDb("extcmt_dst");
    dbs.push(src, dst);
    await src.pool.query(`CREATE EXTENSION hstore SCHEMA public;`);
    await dst.pool.query(
      `CREATE EXTENSION hstore SCHEMA public;
       COMMENT ON FUNCTION hstore(text, text) IS 'user note on an extension member';`,
    );
    const [s, d] = await Promise.all([extract(src.pool), extract(dst.pool)]);
    const thePlan = plan(s.factBase, d.factBase);
    const sql = thePlan.actions.map((a) => a.sql);

    expect(
      sql.some((x) => /CREATE (OR REPLACE )?FUNCTION.*hstore/.test(x)),
    ).toBe(false);
    expect(
      sql.some(
        (x) => x.includes("COMMENT ON FUNCTION") && x.includes("hstore"),
      ),
    ).toBe(true);

    const clone = await src.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, d.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);

  // A REVOKE of an extension member's INSTALL-TIME grant (here PUBLIC EXECUTE,
  // which acldefault gives every function) is a customization BELOW the
  // as-installed state — the init-privs delta must emit it, and the reverse
  // (dropping the customization) must RESTORE the install grant, not blindly
  // REVOKE ALL. Both directions are invisible to the corpus proof loop because
  // extraction is symmetrically blind, so they are asserted on plan shape.
  test("a REVOKE ... FROM PUBLIC on a member function is planned + restored on drop", async () => {
    const cluster = await sharedCluster();
    const plain = await cluster.createDb("extrev_plain");
    const revoked = await cluster.createDb("extrev_revoked");
    dbs.push(plain, revoked);
    await plain.pool.query(`CREATE EXTENSION hstore SCHEMA public;`);
    await revoked.pool.query(
      `CREATE EXTENSION hstore SCHEMA public;
       REVOKE EXECUTE ON FUNCTION hstore(text, text) FROM PUBLIC;`,
    );
    const [plainState, revokedState] = await Promise.all([
      extract(plain.pool),
      extract(revoked.pool),
    ]);

    // forward (plain -> revoked): the REVOKE must appear (RED today: both sides
    // extract no PUBLIC acl fact, so the diff is empty).
    const forward = plan(plainState.factBase, revokedState.factBase);
    const fwdSql = forward.actions.map((a) => a.sql);
    expect(fwdSql.some((s) => /REVOKE .*hstore.* FROM PUBLIC/.test(s))).toBe(
      true,
    );
    const fclone = await plain.clone();
    dbs.push(fclone);
    const fwdVerdict = await provePlan(
      forward,
      fclone.pool,
      revokedState.factBase,
    );
    expect(fwdVerdict.ok).toBe(true);

    // reverse (revoked -> plain): dropping the customization RESTORES the
    // install grant (GRANT ... TO PUBLIC), not a bare REVOKE ALL.
    const reverse = plan(revokedState.factBase, plainState.factBase);
    const revSql = reverse.actions.map((a) => a.sql);
    expect(revSql.some((s) => /GRANT .*hstore.* TO PUBLIC/.test(s))).toBe(true);
    const rclone = await revoked.clone();
    dbs.push(rclone);
    const revVerdict = await provePlan(
      reverse,
      rclone.pool,
      plainState.factBase,
    );
    expect(revVerdict.ok).toBe(true);
  }, 120_000);
});
