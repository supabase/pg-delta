/**
 * Dependency-resolution decision for the provenance flip (4b Stage 3).
 * Docker required (the Supabase image, which ships citext).
 *
 * DECISION: keep the pg_depend resolver's "collapse member references to the
 * extension" behaviour (src/extract/extract.ts, the pg_proc / pg_type / … CASE
 * branches), now that members are also observed as facts (Stage 2).
 *
 * Why not re-point references to the member fact? A user object that depends on
 * an extension member (a table column of an extension type, a default calling
 * an extension function) records a pg_depend edge to the MEMBER. The resolver
 * collapses that to a depends edge on the EXTENSION. The member is now kept
 * REFERENCE-ONLY (not hard-pruned), but it is never a create action of its own,
 * so a depends edge on the member would give the user object no "create the
 * extension first" constraint. The collapsed edge points at the extension
 * (which CREATE EXTENSION produces), so the ordering holds.
 *
 * This test pins that: a user table using an extension type is ordered AFTER the
 * extension and proves clean. (Member-as-fact observation + projection is
 * covered by extension-member-parity and extension-intent-partman.)
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { supabaseCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("extension-member ordering (4b Stage 3): resolver collapse preserves ordering", () => {
  test("a table using an extension type is ordered after the extension and proves clean", async () => {
    const cluster = await supabaseCluster();

    // DESIRED: a user table whose column uses citext, an extension-owned type
    const desired = await cluster.createDb("ext_order_desired");
    dbs.push(desired);
    await desired.pool.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    await desired.pool.query(
      `CREATE TABLE public.contacts (id integer PRIMARY KEY, email citext NOT NULL)`,
    );

    // SOURCE: empty — the plan must build the extension AND the table
    const source = await cluster.createDb("ext_order_source");
    dbs.push(source);

    const desiredState = await extract(desired.pool);
    const sourceState = await extract(source.pool);
    const thePlan = plan(sourceState.factBase, desiredState.factBase);

    // the table's CREATE must come after the extension's CREATE (identified by
    // the StableId each action produces — not by SQL text)
    const produces = (kind: string, name: string) =>
      thePlan.actions.findIndex((a) =>
        a.produces.some(
          (id) => id.kind === kind && (id as { name?: string }).name === name,
        ),
      );
    const extIdx = produces("extension", "citext");
    const tableIdx = produces("table", "contacts");
    expect(extIdx).toBeGreaterThanOrEqual(0);
    expect(tableIdx).toBeGreaterThan(extIdx);

    // end-to-end: applying the plan to an empty clone converges and preserves
    // data — this is the real ordering check (a table built before its
    // extension would fail to apply, so proof would not be ok)
    const clone = await source.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, desiredState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 180_000);
});
