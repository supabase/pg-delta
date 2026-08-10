/**
 * Stage 2: catalog → fact base (target-architecture §3.1–3.2).
 *
 * Doctrine carried from the old extractor corpus:
 * - logical names, never physical attnums
 * - canonical `pg_get_*def()` output as the comparison form
 * - extraction queries return identity PARTS as columns; only the
 *   library-side codec builds identity strings (guardrail 1)
 *
 * Capture model: a single REPEATABLE READ READ ONLY transaction on one
 * connection — consistent by construction. `ExtractOptions.concurrency` opts
 * into fanning the families out over additional connections that all import the
 * coordinator's `pg_export_snapshot()`, which is the same one moment in database
 * time (see ./parallel.ts); serial remains the default and the fallback, and the
 * two produce byte-identical output.
 *
 * Kind coverage is the full v1 set — see packages/pg-delta/COVERAGE.md for
 * the authoritative list (schemas, roles + memberships, extensions, tables and
 * their sub-facts, foreign tables + their constraints, domains, types, indexes,
 * sequences, views, materialized views, procedures/aggregates, collations,
 * policies, triggers, event triggers, publications, subscriptions, FDWs,
 * servers, user mappings, comments, ACLs, security labels). Extension-member
 * objects carry `memberOfExtension` provenance edges and are projected out of
 * the managed view by default (managed-view architecture).
 *
 * The per-family query builders live in sibling modules (`./roles.ts`,
 * `./relations.ts`, `./types.ts`, …) and share the scope, SQL fragments, and
 * the mutable extraction context defined in `./scope.ts`. `extractOnClient`
 * below is the orchestrator: it calls each family in a fixed order so the
 * resulting fact / edge / diagnostic ordering is identical regardless of how
 * the builders are grouped into files.
 */
import createDebug from "debug";
import type { Pool, PoolClient } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
  type FactBase,
  type FactSource,
} from "../core/fact.ts";
import type { ExtensionHandler, HandlerContext } from "./handler.ts";
import {
  applyDependencyRows,
  extractDependencyEdges,
  extractInheritanceEdges,
  fetchDependencyRows,
} from "./dependencies.ts";
import { extractEventTriggers } from "./event-triggers.ts";
import { extractForeign } from "./foreign.ts";
import { extractPolicies } from "./policies.ts";
import { extractPublications, extractSubscriptions } from "./publications.ts";
import {
  extractColumns,
  extractIndexes,
  extractRules,
  extractSequences,
  extractTableConstraints,
  extractTables,
  extractTriggers,
  extractViews,
} from "./relations.ts";
import { extractRolesAndGrants } from "./roles.ts";
import { extractAggregates, extractRoutines } from "./routines.ts";
import { extractSchemasAndExtensions } from "./schemas.ts";
import {
  closeSnapshotWorkers,
  isUsableSnapshotId,
  releaseClients,
  reserveWorkerClients,
  resolveStreamCount,
  runSlottedJobs,
  setupSnapshotWorkers,
  type SnapshotWorker,
} from "./parallel.ts";
import {
  createCollectorContext,
  type ExtractContext,
  ExtractionTimeoutError,
  jitOffSql,
  makeBatchRunner,
  makeQueryRunner,
  openExtractionSession,
  type OpenedSession,
  pruneOrphanedSatellites,
  type QueryRunner,
  type Row,
} from "./scope.ts";

const log = createDebug("pgdelta:extract");

/** Error text for a debug line, without assuming an Error was thrown. */
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
import { extractSecurityLabels } from "./security-labels.ts";
import { extractCollations, extractDomains, extractTypes } from "./types.ts";
import { detectUnmodeledKinds } from "./unmodeled.ts";

// re-exported for the public API surface (src/index.ts and the test suite)
export { ExtractionTimeoutError, pruneOrphanedSatellites };

export interface ExtractResult {
  factBase: FactBase;
  pgVersion: string;
  diagnostics: Diagnostic[];
}

export interface ExtractOptions {
  source?: FactSource;
  statementTimeoutMs?: number;
  /**
   * Extension handlers, run on the SAME snapshot-bound transaction as core
   * extraction (before COMMIT), so handler-produced `managedBy` edges describe
   * the same moment in database time as the core facts. Default: none (bare
   * core extraction; the corpus path). An integration supplies its profile's
   * handlers here so the managed view is coherent.
   */
  handlers?: readonly ExtensionHandler[];
  /**
   * Redact sensitive foreign-data option values and subscription conninfo at
   * extract time (default true). When false, real credentials are kept in the
   * fact base and therefore surface in EVERY downstream channel — plan SQL,
   * snapshot, declarative export, plan artifact, and the fingerprint digest.
   * This is an explicit, loud escape hatch (it raises a `secret-redaction-
   * disabled` warning diagnostic): only disable it when the output is destined
   * for a trusted target that needs working credentials. Source and desired
   * extractions must use the SAME setting or the diff is meaningless.
   */
  redactSecrets?: boolean;
  /**
   * Opt-in number of concurrent catalog-query streams (default 1 = serial, the
   * pre-existing code path exactly). Above 1, the coordinator exports its
   * snapshot with `pg_export_snapshot()` and the extractor families are fanned
   * out over that many connections from the SAME pool, all importing that
   * snapshot — so the capture is still one consistent moment in database time and
   * the output (facts, edges, diagnostics, fingerprint) is byte-identical to a
   * serial run. It only buys wall time, and it only buys much on a high-latency
   * link, where the serial extractor is dominated by ~40 sequential round trips.
   *
   * Clamped to the pool's own `max` (the coordinator holds a client for the whole
   * extraction, so requesting more than the pool can spare would deadlock on
   * `connect()`) and to a hard cap of 8. Degrades SILENTLY to serial — no extra
   * diagnostic, identical output — whenever the snapshot cannot be shared
   * (a standby, a pooler that blocks `SET TRANSACTION SNAPSHOT`, a `max: 1` pool).
   * Must be an integer >= 1.
   */
  concurrency?: number;
}

/**
 * THE extraction order, and the single source of truth for it: the serial path
 * awaits these in sequence, and the bounded-parallel scheduler merges its
 * per-family result slots in exactly this order. Every entry takes only an
 * `ExtractContext` and reads nothing another family produced, which is what makes
 * them freely schedulable.
 *
 * `extractDependencyEdges` is deliberately NOT here: its row post-processing is
 * the one place in the extractor that reads `ctx.facts`, so it is split (SQL half
 * schedulable, processing half deferred to after the merge — see
 * ./dependencies.ts) and both paths run it last.
 */
const FAMILIES: readonly ((ctx: ExtractContext) => Promise<void>)[] = [
  extractRolesAndGrants,
  extractSchemasAndExtensions,
  extractTables,
  extractColumns,
  extractTableConstraints,
  extractIndexes,
  extractSequences,
  extractViews,
  extractRoutines,
  extractTriggers,
  extractPolicies,
  extractDomains,
  extractTypes,
  extractCollations,
  extractEventTriggers,
  extractRules,
  extractAggregates,
  extractForeign,
  extractPublications,
  extractSubscriptions,
  extractSecurityLabels,
  extractInheritanceEdges,
];

/** `target.push(...source)` without the spread's argument-count ceiling — these
 *  arrays are per-family catalog output and can be very large. */
function appendAll<T>(target: T[], source: readonly T[]): void {
  for (const item of source) target.push(item);
}

export async function extract(
  pool: Pool,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  // Validated BEFORE a client is checked out, so a bad option can never leak a
  // connection or an open transaction.
  const streams = resolveStreamCount(options.concurrency, pool.options?.max);
  const client = await pool.connect();
  try {
    const result = await extractOnClient(
      client,
      options.source ?? "liveDb",
      options.statementTimeoutMs,
      options.handlers ?? [],
      options.redactSecrets ?? true,
      streams > 1 ? { pool, streams } : undefined,
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function extractOnClient(
  client: PoolClient,
  source: FactSource,
  statementTimeoutMs: number | undefined,
  handlers: readonly ExtensionHandler[],
  redactSecrets: boolean,
  parallel: { pool: Pool; streams: number } | undefined,
): Promise<ExtractResult> {
  const q = makeQueryRunner(client, statementTimeoutMs);
  const batch = makeBatchRunner(client, statementTimeoutMs);

  // Reserve the worker clients NOW, in parallel with the coordinator's opening
  // batch below. A `pool.connect()` is its own round trip (a full TCP+TLS
  // handshake on a cold pool) and needs nothing from the coordinator except the
  // snapshot id, which only exists once that batch resolves — so waiting for
  // setup to finish before even asking for connections was pure dead time.
  const reserving =
    parallel === undefined
      ? undefined
      : reserveWorkerClients(parallel.pool, parallel.streams - 1);

  // The reservations are owned by exactly one of these two, once: `takeReserved`
  // to put them to work, `handBackReserved` to give them up. extract()'s own
  // cleanup only knows about the coordinator's client, so anything that throws
  // before the handover has to hand them back itself — and a double release is an
  // error in node-pg, hence the latch.
  let reservationsSettled = false;
  const takeReserved = async (): Promise<PoolClient[]> => {
    if (reserving === undefined || reservationsSettled) return [];
    reservationsSettled = true;
    return await reserving;
  };
  const handBackReserved = async (): Promise<void> => {
    releaseClients(await takeReserved());
  };

  // ONE round trip: BEGIN + search_path + optional statement budget + the version
  // probe (+ pg_export_snapshot for the parallel path). See openExtractionSession.
  let opened: OpenedSession;
  try {
    opened = await openExtractionSession(
      batch,
      statementTimeoutMs,
      parallel !== undefined,
    );
  } catch (error) {
    if (parallel === undefined) throw error;
    // The batch carried `pg_export_snapshot()`, which a standby or a restrictive
    // pooler refuses — and a failed statement aborts the WHOLE transaction (it
    // cannot even be shielded by a SAVEPOINT: Postgres refuses to export a
    // snapshot from a subtransaction), so the only route back is a fresh one.
    // Retrying WITHOUT the export both recovers and diagnoses: if that fails too,
    // the snapshot was never the problem and the second error is the real one.
    log("snapshot-sharing setup failed (%s); going serial", errorText(error));
    await handBackReserved();
    await client.query("ROLLBACK").catch(() => {});
    opened = await openExtractionSession(batch, statementTimeoutMs, false);
  }

  const ctx = createCollectorContext(q, opened.version, redactSecrets);

  // JIT is pure per-execution overhead for catalog extraction — the
  // dependency-resolver query's cost estimate trips `jit_above_cost` and
  // re-emits hundreds of functions on every run. `jit` is PGC_USERSET (works
  // for non-superusers) and SET LOCAL / set_config(..., true) scopes it to
  // this transaction. On PG >= 15, guard it behind `has_parameter_privilege`
  // (added alongside parameter ACLs in 15) rather than a bare
  // `SET LOCAL jit = off`: a failed statement poisons the WHOLE transaction
  // (a JS try/catch cannot undo that without a SAVEPOINT), so this must never
  // be able to error — this optimization is not worth risking the rest of
  // extraction. `has_parameter_privilege` never throws, and the WHERE clause
  // makes `set_config` a no-op (0 rows) rather than an error when it returns
  // false, so this is structurally safe regardless of privilege state.
  // (In practice PostgreSQL's own parameter-ACL machinery does not gate
  // PGC_USERSET params like `jit` at the actual SET call site — only
  // `has_parameter_privilege` reflects the ACL, per a postgres-hackers note —
  // so a real `REVOKE SET ON PARAMETER jit FROM PUBLIC` cannot currently
  // reproduce a permission error here. `has_parameter_privilege` IS false by
  // default for any non-superuser though, so this guard still means a
  // non-superuser extraction silently skips the jit-disable rather than
  // depending on that runtime quirk, and it costs nothing if the quirk is
  // ever tightened. See tests/extract-jit-off.test.ts for the detail.)
  // PG 14 has neither `has_parameter_privilege` nor parameter ACLs, so the
  // plain SET LOCAL is used there unconditionally.
  //
  // That version dependence is also why this is a SECOND round trip rather than
  // part of the opening batch: the >= 15 form calls `has_parameter_privilege()`,
  // which does not exist on 14, so it cannot be sent speculatively alongside the
  // probe that reveals the version. It is overlapped with worker setup below, so
  // it costs one RTT for the whole extraction, not one per connection.
  const settingJitOff = client
    .query(jitOffSql(ctx.pgMajor))
    // deliberately non-rejecting: a rejection here must not leave half-built
    // workers unreleased in the Promise.all below
    .then(
      () => undefined,
      (error: unknown) => error,
    );

  // Explicit, loud opt-out: disabling redaction means real credentials flow
  // into plan SQL, snapshot, export, the plan artifact, and the fingerprint.
  // Surface it as a warning so it is never silent.
  if (!redactSecrets) {
    ctx.diagnostics.push({
      code: "secret-redaction-disabled",
      severity: "warning",
      message:
        "Secret redaction is DISABLED: foreign-data option values and subscription conninfo are emitted in cleartext in plan SQL, the catalog snapshot, declarative export, and the plan artifact. Do not persist these artifacts to untrusted locations.",
    });
  }

  const pgVersion = ctx.serverVersion;

  // Worker setup and the coordinator's JIT-off travel together, so the whole
  // preamble is 2 round trips regardless of the stream count. Neither side
  // rejects, so a failure on one can never orphan the other's connections.
  const usableSnapshot =
    opened.snapshotId !== undefined && isUsableSnapshotId(opened.snapshotId)
      ? opened.snapshotId
      : undefined;
  const reserved = await takeReserved();
  const [workers, jitError] = await Promise.all([
    usableSnapshot === undefined
      ? Promise.resolve<SnapshotWorker[] | undefined>(undefined)
      : setupSnapshotWorkers(
          reserved,
          usableSnapshot,
          statementTimeoutMs,
          ctx.pgMajor,
        ),
    settingJitOff,
  ]);
  if (jitError !== undefined) {
    // exactly one owner of the reserved clients: a built worker set owns them
    // (close it), a failed setupSnapshotWorkers already released them, and an
    // unused reservation is released here.
    if (workers !== undefined) await closeSnapshotWorkers(workers);
    else if (usableSnapshot === undefined) releaseClients(reserved);
    throw jitError;
  }
  // nothing to share the snapshot with — hand the reservations straight back
  if (usableSnapshot === undefined) releaseClients(reserved);

  // The call order IS the extraction order: facts / edges / diagnostics are
  // accumulated in `ctx` in the order these run, so this sequence is preserved
  // exactly from the pre-split single-function extractor. It is also the order
  // the bounded-parallel scheduler merges its per-family slots in, which is what
  // makes the two paths produce byte-identical output (see FAMILIES below).
  if (workers !== undefined && workers.length > 0) {
    try {
      await runFamiliesAcrossStreams(
        ctx,
        [ctx.q, ...workers.map((worker) => worker.q)],
        redactSecrets,
      );
    } finally {
      // the coordinator's transaction keeps the snapshot alive, so it stays open
      // (extract() COMMITs long after this) while every worker is closed here
      await closeSnapshotWorkers(workers);
    }
  } else {
    for (const family of FAMILIES) await family(ctx);
    await extractDependencyEdges(ctx);
  }

  // drop metadata satellites whose target was filtered (Item 4a) before
  // building — a satellite with a missing target would otherwise throw
  const pruned = pruneOrphanedSatellites(ctx.facts);
  ctx.diagnostics.push(...pruned.diagnostics);
  let factBase = buildFactBase(pruned.facts, ctx.edges, source);

  // Extension handlers run HERE — on the same snapshot-bound client, inside the
  // still-open REPEATABLE READ transaction (extract() COMMITs only after this
  // returns). Handler queries therefore see the exact snapshot core extraction
  // saw, so the `managedBy` edges they emit line up with the core fact base
  // even under concurrent DDL / partition creation. The handler context exposes
  // only the timeout-aware query runner, not the catalog push helpers — handlers
  // contribute their own facts/edges, they do not mutate the core buffers.
  if (handlers.length > 0) {
    const handlerCtx: HandlerContext = { query: ctx.q };
    const extraFacts: Fact[] = [];
    const extraEdges: DependencyEdge[] = [];
    const extraDiagnostics: Diagnostic[] = [];
    for (const handler of handlers) {
      const captured = await handler.capture(handlerCtx, factBase);
      extraFacts.push(...captured.facts);
      extraEdges.push(...captured.edges);
      if (captured.diagnostics) extraDiagnostics.push(...captured.diagnostics);
    }
    if (extraFacts.length > 0 || extraEdges.length > 0) {
      factBase = buildFactBase(
        [...factBase.facts(), ...extraFacts],
        [...factBase.edges, ...extraEdges],
        source,
      );
    }
    // handler diagnostics ride on the fact base itself — `plan()` reads
    // `rawDesired.diagnostics` to gate a desired-side unkeyed-intent (an unnamed
    // pg_cron job that can never converge). Pushed before line ~221 copies
    // factBase.diagnostics into ctx.diagnostics, so they also reach
    // ExtractResult.diagnostics for CLI rendering.
    factBase.diagnostics.push(...extraDiagnostics);
  }

  // Diagnostics a query-family builder flagged as needing to ride on the
  // FactBase itself (e.g. a skipped user-mapping fact `plan()` must gate
  // against — see ExtractContext.factDiagnostics). MUST be pushed AFTER the
  // handler block above, not before: when a handler contributes facts/edges,
  // `factBase` is REASSIGNED to a fresh instance with an empty `.diagnostics`
  // array (buildFactBase never carries diagnostics over), so pushing here
  // first would silently orphan them for exactly the integration-profile
  // (Supabase / handler-bearing) callers plan()'s gate most needs to protect.
  // A handler's capture() therefore sees the PRE-rebuild base without these —
  // harmless today since no handler inspects diagnostics. Folded into
  // `ctx.diagnostics` by the copy below, same as handler diagnostics.
  factBase.diagnostics.push(...ctx.factDiagnostics);

  // dangling edges (e.g. references to unextracted kinds) become diagnostics
  ctx.diagnostics.push(...factBase.diagnostics);
  // catalog completeness: user objects in kinds we don't model are reported,
  // never silently missed (review finding 1). Same snapshot, one round-trip.
  ctx.diagnostics.push(...(await detectUnmodeledKinds(client, ctx.pgMajor)));
  return { factBase, pgVersion, diagnostics: ctx.diagnostics };
}

/**
 * Run `FAMILIES` (plus the pg_depend resolver's SQL half) across the given query
 * runners — one per connection, `runners[0]` being the coordinator's — then merge
 * the per-family results into `ctx` in FAMILY order.
 */
async function runFamiliesAcrossStreams(
  ctx: ExtractContext,
  runners: readonly QueryRunner[],
  redactSecrets: boolean,
): Promise<void> {
  const version = {
    serverVersion: ctx.serverVersion,
    serverVersionNum: ctx.serverVersionNum,
    pgMajor: ctx.pgMajor,
  };

  // Every family gets its OWN collector, so its output can be slotted by family
  // index; a family that shared a stream's buffers would interleave with
  // whatever else that stream ran.
  let dependRows: readonly Row[] = [];
  const familyJobs: ((
    stream: number,
  ) => Promise<ExtractContext | undefined>)[] = FAMILIES.map(
    (family) =>
      async (stream: number): Promise<ExtractContext> => {
        const collector = createCollectorContext(
          runners[stream]!,
          version,
          redactSecrets,
        );
        await family(collector);
        return collector;
      },
  );
  // The pg_depend resolver is the single most expensive query in the
  // extractor. `runSlottedJobs` pulls jobs off this array in INDEX order (see
  // ./parallel.ts's `pull`), so it must be job 0, not the last one — appended
  // after all 22 family jobs, it would only start once a stream freed up from
  // the rest of the schedule and become a serial tail at low stream counts.
  // Putting it first here changes PULL order only: it contributes no
  // facts/edges of its own (only rows for the post-merge step below), so its
  // slot is always `undefined` and the merge loop below — which is what
  // actually determines fact/edge order — skips it regardless of position.
  const jobs: ((stream: number) => Promise<ExtractContext | undefined>)[] = [
    async (stream: number): Promise<undefined> => {
      dependRows = await fetchDependencyRows({ q: runners[stream]! });
      return undefined;
    },
    ...familyJobs,
  ];

  // The stream count follows the connections we ACTUALLY have, never what was
  // requested: a busy shared pool can yield fewer workers than asked for, and a
  // job scheduled onto a stream with no connection would have no query runner.
  const slots = await runSlottedJobs(jobs, runners.length);

  // Deterministic merge: family order, NEVER completion order. This is the
  // whole equivalence argument — see ./parallel.ts.
  for (const collector of slots) {
    if (collector === undefined) continue;
    appendAll(ctx.facts, collector.facts);
    appendAll(ctx.edges, collector.edges);
    appendAll(ctx.diagnostics, collector.diagnostics);
    appendAll(ctx.factDiagnostics, collector.factDiagnostics);
  }
  // last, exactly as in the serial order, and against the MERGED facts (it
  // reads them to decide GENERATED-column shadow edges)
  applyDependencyRows(ctx, dependRows);
}
