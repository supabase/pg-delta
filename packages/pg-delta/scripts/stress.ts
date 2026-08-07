#!/usr/bin/env bun
/**
 * Catalog stress test: extraction/diff/plan on a big catalog, generated
 * server-side via a `DO` block (roles + per-schema grants, views, functions,
 * identity PKs). Reports phase wall-times, catalog stats, and process RSS.
 *
 *   bun scripts/stress.ts             # spins a disposable container, quick scale
 *   bun scripts/stress.ts <pg-url>    # uses an existing server
 *   bun scripts/stress.ts --full      # 100 schemas x 500 tables x 20 cols (~1.8M facts)
 *
 * Scale knobs (checked in this order — env vars win over `--full`):
 *   PGDELTA_STRESS_SCHEMAS / PGDELTA_STRESS_TABLES / PGDELTA_STRESS_COLS
 *
 * Default (quick) scale is 20 schemas x 250 tables x 20 columns (~190k
 * facts, ~20s to generate) for a fast feedback loop; `--full` reproduces the
 * ~1.8M-fact configuration used to validate extraction-time work (see the
 * commit that introduced this script for the reference numbers).
 *
 * Set PGDELTA_BENCH_PER_QUERY=1 to additionally attribute the cold extract's
 * wall-time per SQL round-trip (same env var and mechanism as
 * scripts/benchmark.ts) — prints the top 15 queries by time plus the sum.
 */
import pg from "pg";
import { diff } from "../src/core/diff.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { withPerQueryTiming, type QueryTiming } from "./perf-timing.ts";

const PER_QUERY = process.env["PGDELTA_BENCH_PER_QUERY"] === "1";
const FULL = process.argv.includes("--full");

const [DEFAULT_SCHEMAS, DEFAULT_TABLES] = FULL ? [100, 500] : [20, 250];
const SCHEMAS = Number(
  process.env["PGDELTA_STRESS_SCHEMAS"] ?? DEFAULT_SCHEMAS,
);
const TABLES = Number(process.env["PGDELTA_STRESS_TABLES"] ?? DEFAULT_TABLES);
const COLS = Number(process.env["PGDELTA_STRESS_COLS"] ?? 20);

function rss(): string {
  const m = process.memoryUsage();
  return `rss=${(m.rss / 1e9).toFixed(2)}GB heap=${(m.heapUsed / 1e9).toFixed(2)}GB`;
}

async function timed<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  console.log(`${label.padEnd(30)} ${ms.toFixed(0).padStart(9)} ms   ${rss()}`);
  return result;
}

/** Print the top-15-by-time queries plus the sum (stress prints a slice,
 *  unlike benchmark.ts which prints every query — see ./perf-timing.ts). */
function printPerQueryTiming(timings: QueryTiming[]): void {
  let sum = 0;
  for (const t of timings) sum += t.ms;
  console.log(`\nper-query breakdown (top 15 of ${timings.length}):`);
  console.log(`${"ms".padStart(9)} ${"rows".padStart(9)}  query`);
  for (const t of timings.slice(0, 15)) {
    console.log(
      `${t.ms.toFixed(1).padStart(9)} ${String(t.rows).padStart(9)}  ${t.label}`,
    );
  }
  console.log(`sum of query time: ${sum.toFixed(0)} ms\n`);
}

function schemaDdl(s: number): string {
  const schema = `stress_${String(s).padStart(3, "0")}`;
  const colDefs: string[] = [];
  for (let c = 0; c < COLS; c++) {
    colDefs.push(
      c % 4 === 0
        ? `c${c} text DEFAULT ''x''`
        : c % 4 === 1
          ? `c${c} integer DEFAULT 0`
          : c % 4 === 2
            ? `c${c} timestamptz`
            : `c${c} numeric(12,2)`,
    );
  }
  return `
    CREATE SCHEMA ${schema};
    DO $body$
    DECLARE t int;
    BEGIN
      FOR t IN 0..${TABLES - 1} LOOP
        EXECUTE format(
          'CREATE TABLE ${schema}.t%s (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ${colDefs.join(", ")})',
          t
        );
      END LOOP;
      FOR t IN 0..4 LOOP
        EXECUTE format('CREATE VIEW ${schema}.v%s AS SELECT id, c0 FROM ${schema}.t%s', t, t);
      END LOOP;
      EXECUTE 'CREATE FUNCTION ${schema}.f1(a integer) RETURNS integer LANGUAGE sql IMMUTABLE AS ''SELECT a + 1''';
      EXECUTE 'CREATE FUNCTION ${schema}.f2(a text) RETURNS text LANGUAGE sql IMMUTABLE AS ''SELECT a || a''';
      EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO stress_reader';
      EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ${schema} TO stress_writer';
    END
    $body$;
  `;
}

const url = process.argv[2] !== "--full" ? process.argv[2] : undefined;
let pool: pg.Pool;
let cleanup = async (): Promise<void> => {};
if (url !== undefined) {
  pool = new pg.Pool({ connectionString: url, max: 2 });
  cleanup = async () => {
    await pool.end();
  };
} else {
  const { sharedCluster } = await import("../tests/containers.ts");
  const cluster = await sharedCluster();
  const db = await cluster.createDb("stress");
  pool = db.pool;
  cleanup = async () => {
    await db.drop();
    process.exit(0);
  };
}

console.log(
  `stress fixture: ${SCHEMAS} schemas x ${TABLES} tables x ${COLS} cols + identity PK + grants`,
);
console.log(
  `expected: ${SCHEMAS * TABLES} tables, ${SCHEMAS * TABLES * (COLS + 1)} columns`,
);

await timed("create roles", async () => {
  await pool.query("CREATE ROLE stress_reader; CREATE ROLE stress_writer;");
});

const genStart = performance.now();
for (let s = 0; s < SCHEMAS; s++) {
  await pool.query(schemaDdl(s));
  if ((s + 1) % 10 === 0) {
    const elapsed = (performance.now() - genStart) / 1000;
    console.log(
      `  generated ${s + 1}/${SCHEMAS} schemas (${elapsed.toFixed(0)}s elapsed)`,
    );
  }
}
console.log(
  `fixture generation total: ${((performance.now() - genStart) / 1000).toFixed(0)}s`,
);

const catalogStats = await pool.query(
  `SELECT (SELECT count(*) FROM pg_class) AS classes,
          (SELECT count(*) FROM pg_attribute) AS attributes,
          (SELECT count(*) FROM pg_depend) AS depends`,
);
console.log("catalog:", JSON.stringify(catalogStats.rows[0]));

const before = await timed("extract (cold)", async () => {
  if (!PER_QUERY) return extract(pool);
  const { result, timings } = await withPerQueryTiming(pool, () =>
    extract(pool),
  );
  printPerQueryTiming(timings);
  return result;
});
console.log(`fact count: ${before.factBase.facts().length}`);

const again = await timed("extract (warm)", () => extract(pool));
void again;

await pool.query(`
  CREATE SCHEMA stress_new;
  CREATE TABLE stress_new.extra (id integer PRIMARY KEY, note text);
  ALTER TABLE stress_000.t0 ADD COLUMN added_col integer DEFAULT 5;
  DROP VIEW stress_001.v0;
`);
const after = await timed("extract (mutated)", () => extract(pool));

const deltas = await timed("diff", () => diff(before.factBase, after.factBase));
console.log(`delta count: ${deltas.length}`);

const thePlan = await timed("plan (incremental)", () =>
  plan(before.factBase, after.factBase),
);
console.log(`action count: ${thePlan.actions.length}`);

await cleanup();
