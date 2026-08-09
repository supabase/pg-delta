/**
 * Enum value-set rebuild — the temp name the old enum is RENAMEd aside to must
 * be namespace- AND length-safe.
 *
 * Removing an enum value rebuilds the type: `ALTER TYPE e RENAME TO
 * e__pgdelta_replaced`, create the new value set, migrate column dependents,
 * DROP the renamed old type. The temp name must collide with NO occupant of the
 * type namespace (pg_type):
 *
 *   1. Before the fix the collision check consulted only managed `type` facts,
 *      so a TABLE named `<enum>__pgdelta_replaced` (whose implicit row type
 *      occupies pg_type) slipped through and the initial RENAME failed at apply
 *      with "type … already exists".
 *   2. PostgreSQL clips identifiers to 63 BYTES, so a long enum name + suffix
 *      was truncated by the server and could land back on the ORIGINAL name (a
 *      63-byte enum whose temp truncates to itself → RENAME to itself). The temp
 *      name is now clipped to ≤ 63 bytes ourselves so it is stored verbatim.
 *
 * Each case proves end-to-end: the plan APPLIES to a clone of the source and
 * converges on the desired state (before the fix apply crashes on the RENAME).
 *
 * Stock alpine image; Docker required.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster } from "./containers.ts";

async function proveConverges(
  srcSql: string,
  desiredSql: string,
): Promise<{ ok: boolean; detail: string }> {
  const cluster = await sharedCluster();
  const src = await cluster.createDb("enum_tmp_src");
  const desired = await cluster.createDb("enum_tmp_dst");
  try {
    await src.pool.query(srcSql);
    await desired.pool.query(desiredSql);
    const [srcState, desiredState] = [
      await extract(src.pool),
      await extract(desired.pool),
    ];
    const thePlan = plan(srcState.factBase, desiredState.factBase);
    const clone = await src.clone();
    try {
      const verdict = await provePlan(
        thePlan,
        clone.pool,
        desiredState.factBase,
      );
      const detail = verdict.applyError
        ? `apply failed at action ${verdict.applyError.actionIndex}: ${verdict.applyError.message}`
        : `drift ${verdict.driftDeltas.length}`;
      return { ok: verdict.ok, detail };
    } finally {
      await clone.drop();
    }
  } finally {
    await Promise.all([src.drop(), desired.drop()]);
  }
}

describe("enum value-set rebuild temp-name safety", () => {
  test("avoids a TABLE occupying the temp name (namespace collision)", async () => {
    // a table named exactly `<enum>__pgdelta_replaced` reserves that name in
    // pg_type via its implicit row type; the rebuild must step past it.
    const src = `
      CREATE SCHEMA app;
      CREATE TYPE app.status AS ENUM ('a', 'b', 'c');
      CREATE TABLE app.thing (s app.status);
      CREATE TABLE app."status__pgdelta_replaced" (x int);
    `;
    const desired = `
      CREATE SCHEMA app;
      CREATE TYPE app.status AS ENUM ('a', 'b');
      CREATE TABLE app.thing (s app.status);
      CREATE TABLE app."status__pgdelta_replaced" (x int);
    `;
    const { ok, detail } = await proveConverges(src, desired);
    expect(ok, detail).toBe(true);
  }, 120_000);

  test("produces a length-safe temp name for a 63-byte enum", async () => {
    const longName = "e".repeat(63); // max identifier length (63 bytes)
    const src = `
      CREATE SCHEMA app;
      CREATE TYPE app."${longName}" AS ENUM ('a', 'b', 'c');
      CREATE TABLE app.thing (s app."${longName}");
    `;
    const desired = `
      CREATE SCHEMA app;
      CREATE TYPE app."${longName}" AS ENUM ('a', 'b');
      CREATE TABLE app.thing (s app."${longName}");
    `;
    const { ok, detail } = await proveConverges(src, desired);
    expect(ok, detail).toBe(true);
  }, 120_000);
});
