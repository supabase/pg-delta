/**
 * Shared timing helpers for the dev-tooling scripts under `scripts/` (not
 * part of the library): `benchmark.ts` and `stress.ts` both time named
 * phases and, optionally, attribute wall-time per SQL round-trip during an
 * extract. Kept here so the two scripts share one implementation.
 */
import pg from "pg";

/** Identify which extractor a SQL string belongs to: the first FROM relation
 *  plus a short head. Good enough to rank the extraction queries. */
export function queryLabel(sql: string): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  const from = /\bFROM\s+(?:pg_catalog\.)?(\w+)/i.exec(flat);
  return `${(from?.[1] ?? "?").padEnd(20)} ${flat.slice(0, 44)}`;
}

export interface QueryTiming {
  ms: number;
  rows: number;
  label: string;
}

/** Wrap the next-checked-out client's `query` to time each call, run `fn`, then
 *  restore `pool.connect`. Returns the result of `fn` and the sorted (slowest
 *  first) per-query timings — callers format/print the breakdown themselves
 *  since benchmark.ts prints every query while stress.ts prints only the top
 *  15. Measurement only — never touches the library. */
export async function withPerQueryTiming<T>(
  pool: pg.Pool,
  fn: () => Promise<T>,
): Promise<{ result: T; timings: QueryTiming[] }> {
  const timings: QueryTiming[] = [];
  const origConnect = pool.connect.bind(pool);
  (pool as { connect: unknown }).connect = async (...args: unknown[]) => {
    const client = await (
      origConnect as (...a: unknown[]) => Promise<pg.PoolClient>
    )(...args);
    const origQuery = client.query.bind(client) as (
      ...a: unknown[]
    ) => Promise<{ rows: unknown[] }>;
    (client as { query: unknown }).query = (...qa: unknown[]) => {
      const sql = typeof qa[0] === "string" ? qa[0] : String(qa[0]);
      const start = performance.now();
      const ret = origQuery(...qa) as unknown;
      // pg's client.query has a callback overload that returns void, not a
      // promise (pg-pool uses it internally) — only time the promise form.
      if (
        ret == null ||
        typeof (ret as { then?: unknown }).then !== "function"
      ) {
        return ret;
      }
      return (ret as Promise<{ rows: unknown[] }>).then((r) => {
        timings.push({
          ms: performance.now() - start,
          rows: r.rows.length,
          label: queryLabel(sql),
        });
        return r;
      });
    };
    return client;
  };
  try {
    const result = await fn();
    timings.sort((a, b) => b.ms - a.ms);
    return { result, timings };
  } finally {
    (pool as { connect: unknown }).connect = origConnect;
  }
}
