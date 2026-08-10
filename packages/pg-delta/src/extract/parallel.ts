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
import {
  makeBatchRunner,
  makeQueryRunner,
  type QueryRunner,
  workerSessionStatements,
} from "./scope.ts";

const log = createDebug("pgdelta:extract");

/** Error text for a debug line, without assuming an Error was thrown. */
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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

export const isUsableSnapshotId = (id: string): boolean => SNAPSHOT_ID.test(id);

/** Stable label for a worker's setup batch, so a `statement_timeout` firing
 *  during setup still names what was running. */
const WORKER_SETUP_LABEL = "snapshot worker session setup";

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
 * Check out up to `count` spare clients, ALL AT ONCE and WITHOUT waiting for the
 * coordinator's session setup.
 *
 * A `pool.connect()` is a round trip of its own — a full TCP+TLS handshake on a
 * cold pool — and it needs nothing from the coordinator except the snapshot id,
 * which arrives later. Doing this concurrently with the coordinator's opening
 * batch, and in one burst rather than one worker at a time, is most of the setup
 * prefix this function exists to remove.
 *
 * Never throws and never queues: a connect that fails simply yields one fewer
 * stream. The clients come back RAW — no transaction has been started on them, so
 * a caller that changes its mind just has to `releaseClients` them.
 */
export async function reserveWorkerClients(
  pool: Pool,
  count: number,
): Promise<PoolClient[]> {
  const wanted = Math.min(count, spareCapacity(pool));
  if (wanted <= 0) return [];
  const settled = await Promise.allSettled(
    Array.from({ length: wanted }, () => pool.connect()),
  );
  const clients: PoolClient[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") clients.push(outcome.value);
    else {
      log(
        "worker connect failed (%s); continuing with fewer streams",
        message(outcome.reason),
      );
    }
  }
  return clients;
}

/** Hand back clients that were reserved but never put into a transaction. */
export function releaseClients(clients: readonly PoolClient[]): void {
  for (const client of clients) client.release();
}

/**
 * Put every reserved client into the coordinator's snapshot with ONE round trip
 * each, all in parallel — so worker setup costs one RTT in total, not one per
 * statement per worker.
 *
 * Returns undefined — after rolling back and releasing every client it was given —
 * if ANY worker's setup failed: half the streams sharing the snapshot is not a
 * state worth reasoning about, so the caller falls back to serial. An empty input
 * yields an empty array, which the caller also treats as "go serial" (one stream
 * IS the serial path), and is what a fully busy shared pool produces.
 */
export async function setupSnapshotWorkers(
  clients: readonly PoolClient[],
  snapshotId: string,
  statementTimeoutMs: number | undefined,
  pgMajor: number,
): Promise<SnapshotWorker[] | undefined> {
  if (clients.length === 0) return [];
  const statements = workerSessionStatements(
    snapshotId,
    statementTimeoutMs,
    pgMajor,
  );
  // Wrapped BEFORE any statement runs so the cleanup path below covers all of
  // them uniformly (ROLLBACK + release), whether a given client's batch
  // succeeded, failed, or aborted its transaction partway through.
  const workers: SnapshotWorker[] = clients.map((client) => ({
    client,
    q: makeQueryRunner(client, statementTimeoutMs),
  }));
  const settled = await Promise.allSettled(
    workers.map((worker) =>
      makeBatchRunner(worker.client, statementTimeoutMs)(
        statements,
        WORKER_SETUP_LABEL,
      ),
    ),
  );
  const failure = settled.find((outcome) => outcome.status === "rejected");
  if (failure !== undefined) {
    log(
      "snapshot worker setup failed (%s); going serial",
      message((failure as PromiseRejectedResult).reason),
    );
    await closeSnapshotWorkers(workers);
    return undefined;
  }
  return workers;
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
