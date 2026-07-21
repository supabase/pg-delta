/**
 * A role-membership REVOKE must NOT be emitted with CASCADE.
 *
 * The membership drop rule rendered `REVOKE <role> FROM <member> CASCADE`. On
 * PG16+, when the removed membership carried ADMIN OPTION and the member had
 * granted the role onward, CASCADE ALSO deletes those downstream
 * pg_auth_members rows — even ones that exist on BOTH diff sides and are meant
 * to be KEPT. Extraction is grantor-blind by design, so nothing plans a
 * corrective re-grant: the kept membership is silently destroyed.
 *
 * The fix drops CASCADE (plain REVOKE). On PG16+ with a dependent grant the
 * REVOKE now fails LOUDLY ("dependent privileges exist") instead of silently
 * destroying kept grants — the intended behaviour for now (convergent regrant
 * is tracked separately, #333). Either way the kept (a → c) membership must
 * survive the apply attempt.
 *
 * Isolated cluster (mutates cluster-global roles); Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { isolatedClusterPair } from "./containers.ts";

let cleanup: (() => Promise<void>) | undefined;

afterAll(async () => {
  await cleanup?.();
});

describe("role-membership revoke must not CASCADE", () => {
  test("dropping an admin membership emits a plain REVOKE and keeps the downstream grant", async () => {
    const [clusterA, clusterB] = await isolatedClusterPair();
    const baseA = await clusterA.listRoles();
    const baseB = await clusterB.listRoles();
    cleanup = async () => {
      await clusterA.dropRolesExcept(baseA);
      await clusterB.dropRolesExcept(baseB);
    };

    // SOURCE (cluster A): a → b WITH ADMIN OPTION, then b grants a → c.
    await clusterA.adminPool.query(`
        CREATE ROLE f3_a NOLOGIN;
        CREATE ROLE f3_b NOLOGIN;
        CREATE ROLE f3_c NOLOGIN;
        GRANT f3_a TO f3_b WITH ADMIN OPTION;
        SET ROLE f3_b;
        GRANT f3_a TO f3_c;
        RESET ROLE;
      `);
    // DESIRED (cluster B): keep a → c (granted directly), drop a → b.
    await clusterB.adminPool.query(`
        CREATE ROLE f3_a NOLOGIN;
        CREATE ROLE f3_b NOLOGIN;
        CREATE ROLE f3_c NOLOGIN;
        GRANT f3_a TO f3_c;
      `);

    const [src, dst] = [
      await extract(clusterA.adminPool),
      await extract(clusterB.adminPool),
    ];
    const thePlan = plan(src.factBase, dst.factBase);

    // exactly the (a → b) membership is revoked …
    const revokes = thePlan.actions.filter((a) =>
      /REVOKE\s+"?f3_a"?\s+FROM\s+"?f3_b"?/i.test(a.sql),
    );
    expect(revokes).toHaveLength(1);
    // … and it must NOT carry CASCADE (that silently destroys the kept a → c).
    expect(revokes[0]!.sql).not.toMatch(/CASCADE/i);

    // end-to-end: applying against the source cluster must not silently
    // destroy the kept (a → c). Post-fix the plain REVOKE fails loudly on
    // PG16+; today's CASCADE succeeds and cascades (a → c) away.
    await apply(thePlan, clusterA.adminPool);
    const remaining = await clusterA.adminPool.query(`
        SELECT 1
        FROM pg_auth_members m
        JOIN pg_roles r ON r.oid = m.roleid
        JOIN pg_roles mem ON mem.oid = m.member
        WHERE r.rolname = 'f3_a' AND mem.rolname = 'f3_c'
      `);
    expect(remaining.rowCount).toBe(1);
  }, 120_000);
});
