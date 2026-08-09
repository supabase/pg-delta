#!/usr/bin/env bun
/**
 * The benchmark fixture + timing harness (stage 5 deliverable 8): a
 * ≥10k-object schema and extract/diff/plan wall-times. Stage 10's
 * performance-parity bar reads these numbers; run it in CI so regressions
 * surface long before cutover.
 *
 *   bun scripts/benchmark.ts             # spins a disposable container
 *   bun scripts/benchmark.ts <pg-url>    # uses an existing server
 *
 * Set PGDELTA_BENCH_PER_QUERY=1 to additionally attribute the cold extract's
 * wall-time per SQL round-trip (milestone A "profile first") — it wraps the
 * pooled client's `query` for the duration of that one extract, then restores
 * it, so the rest of the run is unaffected.
 */
import pg from "pg";
import { diff } from "../src/core/diff.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { withPerQueryTiming, type QueryTiming } from "./perf-timing.ts";

const PER_QUERY = process.env["PGDELTA_BENCH_PER_QUERY"] === "1";

/** Print every query's timing, sorted slowest-first. The wrapper that
 *  collects them (`withPerQueryTiming`) lives in ./perf-timing.ts, shared
 *  with scripts/stress.ts. */
function printPerQueryTiming(timings: QueryTiming[]): void {
  let sum = 0;
  console.log(`\nper-query breakdown (${timings.length} queries):`);
  console.log(`${"ms".padStart(8)} ${"rows".padStart(7)}  query`);
  for (const t of timings) {
    sum += t.ms;
    console.log(
      `${t.ms.toFixed(1).padStart(8)} ${String(t.rows).padStart(7)}  ${t.label}`,
    );
  }
  console.log(`sum of query time: ${sum.toFixed(0)} ms\n`);
}

const SCHEMAS = 40;
const TABLES_PER_SCHEMA = 15;
const COLUMNS_PER_TABLE = 8;

function fixtureSql(): string {
  const parts: string[] = [];
  for (let s = 0; s < SCHEMAS; s++) {
    const schema = `bench_${String(s).padStart(2, "0")}`;
    parts.push(`CREATE SCHEMA ${schema};`);
    parts.push(
      `CREATE TYPE ${schema}.status AS ENUM ('a', 'b', 'c');`,
      `CREATE SEQUENCE ${schema}.ids;`,
      `CREATE FUNCTION ${schema}.f(a integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT a + 1';`,
    );
    for (let t = 0; t < TABLES_PER_SCHEMA; t++) {
      const table = `${schema}.t${String(t).padStart(2, "0")}`;
      const cols = [
        "id integer NOT NULL DEFAULT nextval('" + schema + ".ids')",
      ];
      for (let c = 0; c < COLUMNS_PER_TABLE; c++) {
        cols.push(
          c % 3 === 0
            ? `c${c} text`
            : c % 3 === 1
              ? `c${c} numeric(12,2) DEFAULT 0`
              : `c${c} timestamptz`,
        );
      }
      cols.push("PRIMARY KEY (id)");
      parts.push(`CREATE TABLE ${table} (${cols.join(", ")});`);
      parts.push(`CREATE INDEX t${t}_c0_idx_${s} ON ${table} (c0);`);
      if (t % 2 === 0) {
        parts.push(
          `CREATE VIEW ${schema}.v${t} AS SELECT id, c0 FROM ${table} WHERE id > 0;`,
        );
        parts.push(`COMMENT ON TABLE ${table} IS 'bench table ${t}';`);
      }
    }
  }
  return parts.join("\n");
}

const MUTATIONS = `
  CREATE SCHEMA bench_new;
  CREATE TABLE bench_new.extra (id integer PRIMARY KEY, note text);
  ALTER TABLE bench_00.t00 ADD COLUMN added_col integer DEFAULT 5;
  DROP VIEW bench_01.v0;
  COMMENT ON SCHEMA bench_02 IS 'mutated';
`;

async function timed<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  console.log(`${label.padEnd(28)} ${ms.toFixed(0).padStart(8)} ms`);
  return result;
}

const url = process.argv[2];
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
  const db = await cluster.createDb("bench");
  pool = db.pool;
  cleanup = async () => {
    await db.drop();
    process.exit(0);
  };
}

console.log(
  `fixture: ${SCHEMAS} schemas x ${TABLES_PER_SCHEMA} tables x ${COLUMNS_PER_TABLE} columns`,
);
await timed("load fixture DDL", () => pool.query(fixtureSql()));

const before = await timed("extract (cold)", async () => {
  if (!PER_QUERY) return extract(pool);
  const { result, timings } = await withPerQueryTiming(pool, () =>
    extract(pool),
  );
  printPerQueryTiming(timings);
  return result;
});
console.log(`fact count: ${before.factBase.facts().length}`);

await pool.query(MUTATIONS);
const after = await timed("extract (mutated)", () => extract(pool));

const deltas = await timed("diff", () => diff(before.factBase, after.factBase));
console.log(`delta count: ${deltas.length}`);

const thePlan = await timed("plan (incremental)", () =>
  plan(before.factBase, after.factBase),
);
console.log(`action count: ${thePlan.actions.length}`);

await timed("plan (full materialize)", async () => {
  const { buildFactBase } = await import("../src/core/fact.ts");
  return plan(buildFactBase([], []), after.factBase);
});

await cleanup();
