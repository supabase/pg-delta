/**
 * The `CREATE EXTENSION … SCHEMA` clause is derived from the extension's
 * `relocatable` fact (pg_extension.extrelocatable), not a `skipSchema` serialize
 * param (docs/architecture/managed-view-architecture.md, move 2). Two real-database proofs:
 *
 *  A. a relocatable extension (hstore, stock alpine) extracts relocatable=true
 *     and roundtrips WITH a SCHEMA clause.
 *  B. a non-relocatable self-schema extension (pgmq, Supabase image) extracts
 *     relocatable=false and roundtrips with a BARE CREATE — proving the
 *     skipSchema hack removal is safe: the plan applies to a clone that has no
 *     pgmq schema beforehand, so the create needs no schema dependency.
 *
 * Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster, supabaseCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

function relocatableOf(
  state: Awaited<ReturnType<typeof extract>>,
  name: string,
): unknown {
  const ext = state.factBase
    .facts()
    .find((f) => f.id.kind === "extension" && f.id.name === name);
  return ext?.payload["relocatable"];
}

describe("extension SCHEMA clause derived from relocatable (e2e)", () => {
  test("relocatable extension extracts relocatable=true and roundtrips with SCHEMA", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("ext_reloc_src");
    const dst = await cluster.createDb("ext_reloc_dst");
    dbs.push(src, dst);
    await dst.pool.query("CREATE EXTENSION hstore");

    const srcState = await extract(src.pool);
    const dstState = await extract(dst.pool);

    // extraction is catalog-true
    const { rows } = await dst.pool.query(
      "SELECT extrelocatable FROM pg_extension WHERE extname = 'hstore'",
    );
    expect(relocatableOf(dstState, "hstore")).toBe(rows[0].extrelocatable);
    expect(relocatableOf(dstState, "hstore")).toBe(true);

    const thePlan = plan(srcState.factBase, dstState.factBase);
    const clone = await src.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);

  test("non-relocatable self-schema extension (pgmq) roundtrips with a BARE create — no skipSchema", async () => {
    const cluster = await supabaseCluster();
    const src = await cluster.createDb("ext_pgmq_src");
    const dst = await cluster.createDb("ext_pgmq_dst");
    dbs.push(src, dst);
    await dst.pool.query("CREATE EXTENSION pgmq");

    const srcState = await extract(src.pool);
    const dstState = await extract(dst.pool);

    // pgmq pins its own schema → non-relocatable; extraction is catalog-true
    const { rows } = await dst.pool.query(
      "SELECT extrelocatable FROM pg_extension WHERE extname = 'pgmq'",
    );
    expect(rows[0].extrelocatable).toBe(false);
    expect(relocatableOf(dstState, "pgmq")).toBe(false);

    // The plan applies to a clone of `src` that has NO pgmq schema beforehand.
    // If the create still emitted `SCHEMA pgmq` + consumed that schema, the
    // missing-requirement guard would throw at plan time; that it plans and
    // proves clean is the proof of the bare path.
    const thePlan = plan(srcState.factBase, dstState.factBase);
    const clone = await src.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 240_000);
});
