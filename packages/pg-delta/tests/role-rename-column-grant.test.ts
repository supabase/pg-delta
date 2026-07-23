/**
 * Pre-diff role identity normalization for COLUMN-level grants (regression).
 *
 * `ALTER ROLE r_old RENAME TO r_new` carries every role-name-bearing fact by
 * OID — including a column-qualified grant (`pg_attribute.attacl`,
 * `GRANT SELECT (col) ON t TO r_old`). Canonicalization must preserve the
 * relabeled column-ACL id, otherwise a pure role rename spuriously emits a
 * REVOKE/GRANT pair around the rename (which also demands table-grant
 * privileges a rename-only migration should not need). The column-grant
 * feature added an optional `column` field to the `acl` id; the relabel path
 * must preserve it.
 *
 * Roles are cluster-global, so the pair runs on an isolated cluster pair and
 * uses a distinctive role config so the role rename is UNAMBIGUOUS
 * regardless of leftover roles from other tests (same trick as owner-edge
 * test (e)). Docker required.
 */
import { describe, expect, test } from "bun:test";
import { subjectOf } from "../src/core/diff.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { isolatedClusterPair, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];

describe("role rename normalizes a column-level grant (no spurious REVOKE/GRANT)", () => {
  test("pure role rename emits only ALTER ROLE … RENAME TO", async () => {
    const [clusterA, clusterB] = await isolatedClusterPair();
    const srcDb = await clusterA.createDb("rencolgr_src");
    const dstDb = await clusterB.createDb("rencolgr_dst");
    dbs.push(srcDb, dstDb);

    // A distinctive statement_timeout makes the role rename unambiguous despite
    // other tests' cluster-global roles.
    await clusterA.adminPool
      .query(`CREATE ROLE rencolgr_old NOLOGIN`)
      .catch(() => {});
    await clusterA.adminPool
      .query(`ALTER ROLE rencolgr_old SET statement_timeout = '27183ms'`)
      .catch(() => {});
    await srcDb.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (a int, b int);
        GRANT SELECT (a) ON TABLE app.t TO rencolgr_old;
        GRANT SELECT ON TABLE app.t TO rencolgr_old;
      `);

    await clusterB.adminPool
      .query(`CREATE ROLE rencolgr_new NOLOGIN`)
      .catch(() => {});
    await clusterB.adminPool
      .query(`ALTER ROLE rencolgr_new SET statement_timeout = '27183ms'`)
      .catch(() => {});
    await dstDb.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (a int, b int);
        GRANT SELECT (a) ON TABLE app.t TO rencolgr_new;
        GRANT SELECT ON TABLE app.t TO rencolgr_new;
      `);

    const [srcState, dstState] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
    ]);
    const thePlan = plan(srcState.factBase, dstState.factBase, {
      renames: "auto",
    });

    // the role rename is emitted …
    expect(
      thePlan.actions.some(
        (a) => a.sql.includes("RENAME TO") && a.sql.includes("rencolgr_new"),
      ),
    ).toBe(true);
    // … and canonicalization sees BOTH grants as the same OID-carried state:
    // no REVOKE and no GRANT churn around the rename.
    const revokes = thePlan.actions.filter((a) => a.sql.includes("REVOKE"));
    const grants = thePlan.actions.filter((a) => /\bGRANT\b/.test(a.sql));
    expect(revokes.map((a) => a.sql)).toEqual([]);
    expect(grants.map((a) => a.sql)).toEqual([]);
    expect(
      thePlan.deltas.filter((delta) => subjectOf(delta).kind === "acl"),
    ).toEqual([]);

    const verdict = await provePlan(thePlan, srcDb.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);

    await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
    dbs.length = 0;
  }, 120_000);
});
