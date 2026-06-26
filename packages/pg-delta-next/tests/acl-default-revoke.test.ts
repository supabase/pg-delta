/**
 * Regression: an object created with a built-in PUBLIC default *revoked* must
 * still converge. PostgreSQL grants the default (USAGE on types/languages,
 * EXECUTE on functions) to PUBLIC automatically on CREATE, so the plan must
 * emit a `REVOKE … FROM PUBLIC` to reach a desired state where that default was
 * taken away. Before the fix the revoked default was simply absent from the
 * fact base (aclJson coalesced NULL → acldefault, dropping the "PUBLIC has
 * less than the default" signal), so no REVOKE was planned and the fresh object
 * drifted with the default still granted.
 *
 * Docker required.
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { sharedCluster } from "./containers.ts";

async function assertConvergesFromEmpty(seedSql: string, label: string) {
  const cluster = await sharedCluster();
  const source = await cluster.createDb(`acl_rev_src_${label}`);
  const desired = await cluster.createDb(`acl_rev_dst_${label}`);
  try {
    await desired.pool.query(seedSql);
    const [sourceState, desiredState] = [
      await extract(source.pool),
      await extract(desired.pool),
    ];

    const thePlan = plan(sourceState.factBase, desiredState.factBase);
    const report = await apply(thePlan, source.pool, {
      fingerprintGate: false,
    });
    expect(report.status).toBe("applied");

    const afterApply = await extract(source.pool);
    const drift = plan(afterApply.factBase, desiredState.factBase);
    // RED before fix: a residual `REVOKE … FROM PUBLIC` because PG's create-time
    // default was never cleared.
    expect(drift.actions.map((a) => a.sql)).toEqual([]);
  } finally {
    await Promise.all([source.drop(), desired.drop()]);
  }
}

describe("revoked built-in PUBLIC default on create", () => {
  test(
    "type with PUBLIC USAGE revoked converges from empty",
    () =>
      assertConvergesFromEmpty(
        `
          CREATE SCHEMA app;
          CREATE TYPE app.mood AS ENUM ('sad', 'ok', 'happy');
          REVOKE USAGE ON TYPE app.mood FROM PUBLIC;
        `,
        "type",
      ),
    60_000,
  );

  test(
    "function with PUBLIC EXECUTE revoked converges from empty",
    () =>
      assertConvergesFromEmpty(
        `
          CREATE SCHEMA app;
          CREATE FUNCTION app.f() RETURNS int LANGUAGE sql AS 'SELECT 1';
          REVOKE EXECUTE ON FUNCTION app.f() FROM PUBLIC;
        `,
        "func",
      ),
    60_000,
  );
});
