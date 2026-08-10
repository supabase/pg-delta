/**
 * Bounded-parallel extraction: run the extractor families across N connections
 * that all share the coordinator's `pg_export_snapshot()`, so the capture is
 * still ONE consistent moment in database time (see extract.ts's capture model).
 *
 * Why: on a remote database the serial extractor's cost is dominated by
 * serialization, not work — ~40 catalog round trips, each paying full RTT, then
 * server execution, then result transfer, one after another. Fanning the
 * families out over a few connections attacks all three at once. The engine is
 * unusually well shaped for this: every family takes only an `ExtractContext`,
 * there are no per-family caches or module-level mutable state, and the ONLY
 * cross-family read in the whole extractor is `extractDependencyEdges` reading
 * `ctx.facts` — which is why that one family is split into a schedulable SQL half
 * and a post-join processing half (see ./dependencies.ts).
 *
 * The contract is EQUIVALENCE, not speed. Two invariants carry it:
 *
 *  - **Slotted merge.** Each scheduled family gets its OWN collector context and
 *    its results are stored at its family INDEX; the merge concatenates slots in
 *    the fixed call order. Completion order therefore cannot reach the output —
 *    facts, edges, diagnostics and the FactBase rootHash are byte-identical to a
 *    serial run. (Fact insertion order is correctness-irrelevant — buildFactBase
 *    keys by encoded id and re-sorts children — but edge order drives the
 *    dangling-edge diagnostic order, and diagnostics are order-sensitive output.)
 *  - **Silent fallback.** Anything that makes snapshot sharing impossible (a
 *    standby, a pooler that rejects `SET TRANSACTION SNAPSHOT`, a pool that
 *    cannot spare a second client) degrades to the serial path with NO new
 *    diagnostic. `concurrency` is a performance knob; it must never change what a
 *    caller sees, only how long it takes.
 */
import createDebug from "debug";
import type { Pool, PoolClient } from "pg";
import { jitOffSql, makeQueryRunner, type QueryRunner } from "./scope.ts";

const log = createDebug("pgdelta:extract");

/** Hard ceiling on catalog-query streams, whatever the caller asks for. Past a
 *  handful of connections the remaining serialization is server-side (catalog
 *  buffer contention) and the extra connections only cost the target database
 *  backends — which a diff has no right to spend. */
export const MAX_EXTRACT_CONCURRENCY = 8;

/** node-pg's own default `Pool.max` when the caller never set one. */
const DEFAULT_POOL_MAX = 10;

/**
 * How many concurrent catalog-query streams to actually use.
 *
 * The coordinator counts as stream 0 and holds its client for the WHOLE
 * extraction, so anything above 1 means checking out additional clients from the
 * same pool. `pg.Pool.connect()` QUEUES when the pool is exhausted, so asking
 * for more streams than the pool's `max` would deadlock — hence the clamp to the
 * pool's own capacity is a correctness requirement, not a courtesy.
 *
 * Returns 1 for "run the serial path".
 */
export function resolveStreamCount(
  requested: number | undefined,
  poolMax: number | undefined,
): number {
  if (requested === undefined) return 1;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new RangeError(
      `extract concurrency must be an integer >= 1 (got: ${requested})`,
    );
  }
  return Math.min(
    requested,
    MAX_EXTRACT_CONCURRENCY,
    poolMax !== undefined && Number.isFinite(poolMax) && poolMax >= 1
      ? Math.floor(poolMax)
      : DEFAULT_POOL_MAX,
  );
}

/**
 * Run `jobs` over `streamCount` concurrent pullers and return their results
 * SLOTTED BY JOB INDEX — never by completion order. Each job is told which
 * stream it landed on so it can pick that stream's connection.
 *
 * On the first rejection no further job is started, but every already-started job
 * is awaited before this rejects: the caller is about to ROLLBACK and release
 * those connections, and a query still on the wire would break both.
 */
export async function runSlottedJobs<R>(
  jobs: readonly ((stream: number) => Promise<R>)[],
  streamCount: number,
): Promise<R[]> {
  const slots = Array.from({ length: jobs.length }) as R[];
  let next = 0;
  let firstError: unknown;
  let failed = false;

  const pull = async (stream: number): Promise<void> => {
    while (!failed) {
      const index = next++;
      if (index >= jobs.length) return;
      try {
        slots[index] = await jobs[index]!(stream);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
        return;
      }
    }
  };

  // every puller resolves (failures are captured, not thrown), so this awaits
  // ALL in-flight work even on the failure path
  await Promise.all(
    Array.from({ length: Math.max(1, streamCount) }, (_unused, stream) =>
      pull(stream),
    ),
  );
  if (failed) throw firstError;
  return slots;
}

/** A worker connection sharing the coordinator's snapshot. */
export interface SnapshotWorker {
  readonly client: PoolClient;
  readonly q: QueryRunner;
}

/** A server-generated snapshot identifier (`00000004-00000002-1`). Validated
 *  before interpolation because it is the one value here that comes back from the
 *  server and goes straight into SQL text — a pooler could hand back anything. */
const SNAPSHOT_ID = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Export the coordinator's snapshot, or return undefined when the server refuses
 * (a hot standby, a pooler that blocks it, …).
 *
 * A failed statement poisons the WHOLE transaction and `pg_export_snapshot()`
 * explicitly "cannot export a snapshot from a subtransaction", so a SAVEPOINT
 * cannot protect this call: the caller MUST restart the coordinator transaction
 * before falling back to serial. That is the only reason this is a separate,
 * clearly-named step.
 */
export async function exportSnapshot(
  client: PoolClient,
): Promise<string | undefined> {
  try {
    const rows = (await client.query("SELECT pg_export_snapshot() AS id"))
      .rows as { id?: unknown }[];
    const id = rows[0]?.id;
    if (typeof id === "string" && SNAPSHOT_ID.test(id)) return id;
    log("snapshot export returned an unusable identifier; going serial");
    return undefined;
  } catch (error) {
    log(
      "pg_export_snapshot() failed (%s); going serial",
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}

/**
 * Clients `pool` can hand out RIGHT NOW without queueing behind another
 * consumer: the idle ones plus the room left under `max`. The coordinator's own
 * client is already checked out when this is called, so it is correctly excluded.
 *
 * `resolveStreamCount` clamps to `max`, which is what makes a deadlock
 * structurally impossible for a pool dedicated to one extraction (the CLI and
 * platform shape). This is the extra guard for a SHARED pool: if other consumers
 * are already holding clients, take only what is genuinely spare — down to zero,
 * which just means the serial path.
 */
function spareCapacity(pool: Pool): number {
  const max = pool.options?.max ?? DEFAULT_POOL_MAX;
  return Math.max(0, max - pool.totalCount) + pool.idleCount;
}

/**
 * Check out up to `count` extra clients and put each in a REPEATABLE READ READ
 * ONLY transaction bound to the coordinator's exported snapshot, with the same
 * session setup the coordinator has (pg_catalog search_path, the optional
 * statement budget, JIT off).
 *
 * Returns undefined — after rolling back and releasing everything it opened — if
 * ANY worker cannot be set up, so the caller falls back to serial rather than
 * extracting half in parallel. An empty array is also a "go serial" answer for
 * the caller's purposes (one stream is the serial path), and is what a fully busy
 * shared pool yields.
 */
export async function openSnapshotWorkers(
  pool: Pool,
  snapshotId: string,
  count: number,
  statementTimeoutMs: number | undefined,
  pgMajor: number,
): Promise<SnapshotWorker[] | undefined> {
  const workers: SnapshotWorker[] = [];
  const wanted = Math.min(count, spareCapacity(pool));
  try {
    for (let i = 0; i < wanted; i++) {
      const client = await pool.connect();
      // registered BEFORE the first statement, so a failure mid-setup still
      // rolls this client back and releases it in the catch below
      workers.push({ client, q: makeQueryRunner(client, statementTimeoutMs) });
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      // MUST be the first statement of the transaction — Postgres rejects it
      // after any query ("SET TRANSACTION SNAPSHOT must be called before any
      // query"). From here this connection sees exactly the coordinator's
      // catalog, so families can be split across connections freely.
      await client.query(`SET TRANSACTION SNAPSHOT '${snapshotId}'`);
      await client.query("SET LOCAL search_path TO 'pg_catalog'");
      if (statementTimeoutMs !== undefined) {
        await client.query(
          `SET LOCAL statement_timeout = ${Math.max(0, Math.floor(statementTimeoutMs))}`,
        );
      }
      await client.query(jitOffSql(pgMajor));
    }
    return workers;
  } catch (error) {
    log(
      "snapshot worker setup failed (%s); going serial",
      error instanceof Error ? error.message : String(error),
    );
    await closeSnapshotWorkers(workers);
    return undefined;
  }
}

/** ROLLBACK (best effort — the transaction is read-only, there is nothing to
 *  lose) and release every worker client. Never throws: it runs on the failure
 *  path too, where the caller still has its own rollback + rethrow to do. */
export async function closeSnapshotWorkers(
  workers: readonly SnapshotWorker[],
): Promise<void> {
  await Promise.all(
    workers.map(async (worker) => {
      try {
        await worker.client.query("ROLLBACK");
      } catch {
        // a poisoned / broken connection is released regardless — node-pg
        // discards a client whose transaction it cannot clean up
      } finally {
        worker.client.release();
      }
    }),
  );
}
