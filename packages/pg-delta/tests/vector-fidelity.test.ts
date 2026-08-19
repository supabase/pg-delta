/**
 * pgvector index fidelity: opclass + WITH storage parameters survive extract,
 * plan, apply, and export/load. Gated on the Supabase image (stock alpine
 * has no vector).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import {
  exportSqlFiles,
  type ExportOptions,
} from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import {
  runSupabaseBareTests,
  supabaseCluster,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

const VEC384 = `[${Array.from({ length: 384 }, () => "0.1").join(",")}]`;

const HNSW_A = `
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE public.items (
    id integer PRIMARY KEY,
    embedding vector(384) NOT NULL
  );
  CREATE INDEX items_embedding_hnsw ON public.items
    USING hnsw (embedding vector_cosine_ops) WITH (m = 24, ef_construction = 100);
  CREATE INDEX items_embedding_ivf ON public.items
    USING ivfflat (embedding vector_l2_ops) WITH (lists = 50);
`;

const HNSW_B = `
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE public.items (
    id integer PRIMARY KEY,
    embedding vector(384) NOT NULL
  );
  CREATE INDEX items_embedding_hnsw ON public.items
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 100);
`;

function forLoad(files: { name: string; sql: string }[]) {
  return files.filter((f) => !/cluster[_/]roles/.test(f.name));
}

describe.skipIf(!runSupabaseBareTests)("pgvector index fidelity", () => {
  test("roundtrip: hnsw + ivfflat opclass and storage params survive plan+apply", async () => {
    const cluster = await supabaseCluster();
    const src = await cluster.createDb("vec_rt_src");
    const dst = await cluster.createDb("vec_rt_dst");
    dbs.push(src, dst);
    await src.pool.query(HNSW_A);

    const srcFb = (await extract(src.pool)).factBase;
    const dstFb = (await extract(dst.pool)).factBase;
    const thePlan = plan(dstFb, srcFb);
    const indexSql = thePlan.actions
      .filter((a) => a.verb === "create" && /INDEX/.test(a.sql))
      .map((a) => a.sql)
      .sort()
      .join("\n");
    // pg_get_indexdef is canonical: the non-default hnsw cosine opclass is
    // spelled; ivfflat's default vector_l2_ops is omitted. WITH params survive
    // on both. Not an extraction bug — rewriting the def to insert the default
    // opclass would be a semantic edit.
    expect(indexSql).toMatchInlineSnapshot(`
      "CREATE INDEX items_embedding_hnsw ON public.items USING hnsw (embedding public.vector_cosine_ops) WITH (m='24', ef_construction='100')
      CREATE INDEX items_embedding_ivf ON public.items USING ivfflat (embedding) WITH (lists='50')"
    `);

    const clone = await dst.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, srcFb);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 180_000);

  test("index delta: hnsw m=24 → m=16 is a drop+create and converges with data", async () => {
    const cluster = await supabaseCluster();
    const a = await cluster.createDb("vec_delta_a");
    const b = await cluster.createDb("vec_delta_b");
    dbs.push(a, b);
    await a.pool.query(HNSW_A);
    await a.pool.query(
      `INSERT INTO public.items (id, embedding) VALUES (1, '${VEC384}'::vector)`,
    );
    await b.pool.query(HNSW_B);

    const aFb = (await extract(a.pool)).factBase;
    const bFb = (await extract(b.pool)).factBase;
    const thePlan = plan(aFb, bFb);
    const indexActions = thePlan.actions.filter((act) =>
      /items_embedding_hnsw/.test(act.sql),
    );
    expect(indexActions.some((act) => act.verb === "drop")).toBe(true);
    expect(indexActions.some((act) => act.verb === "create")).toBe(true);
    expect(indexActions.find((act) => act.verb === "create")!.sql).toMatch(
      /m\s*=\s*'?16'/,
    );

    const clone = await a.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, bFb);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 180_000);

  test("export fidelity: load(export(db)) ≡ db", async () => {
    const cluster = await supabaseCluster();
    const src = await cluster.createDb("vec_exp_src");
    const shadow = await cluster.createDb("vec_exp_shadow");
    dbs.push(src, shadow);
    await src.pool.query(HNSW_A);
    const fb = (await extract(src.pool)).factBase;
    const layout: NonNullable<ExportOptions["layout"]> = "ordered";
    const files = forLoad(exportSqlFiles(fb, { layout }));
    const loaded = await loadSqlFiles(files, shadow.pool);
    expect(loaded.factBase.rootHash).toBe(fb.rootHash);
  }, 180_000);
});
