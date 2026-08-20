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
 * two produce byte-identical output — serial is literally the 1-stream case of
 * the same plan (`runFamilies` below).
 *
 * Round trips, not statements, are what a remote extraction pays for. The cheap
 * families are therefore packed into a few multi-statement round trips
 * (CATALOG_BATCH_GROUPS) while the measured-expensive ones keep their own, which
 * takes the whole catalog scan from ~38 round trips to ~23 without changing a
 * single query.
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
  fetchDependencyRows,
  inheritanceEdgesFamily,
} from "./dependencies.ts";
import { eventTriggersFamily } from "./event-triggers.ts";
import { extractForeign } from "./foreign.ts";
import { policiesFamily } from "./policies.ts";
import { publicationsFamily, extractSubscriptions } from "./publications.ts";
import {
  columnsFamily,
  indexesFamily,
  rulesFamily,
  sequencesFamily,
  tableConstraintsFamily,
  tablesFamily,
  triggersFamily,
  viewsFamily,
} from "./relations.ts";
import { rolesAndGrantsFamily } from "./roles.ts";
import { aggregatesFamily, routinesFamily } from "./routines.ts";
import { schemasAndExtensionsFamily } from "./schemas.ts";
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
  type BatchRunner,
  type CatalogFamily,
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
  type ServerVersionInfo,
} from "./scope.ts";

const log = createDebug("pgdelta:extract");

/** Error text for a debug line, without assuming an Error was thrown. */
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
import { extractSecurityLabels } from "./security-labels.ts";
import { collationsFamily, domainsFamily, typesFamily } from "./types.ts";
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
   * link, where the serial extractor is dominated by its remaining ~20
   * sequential round trips (see CATALOG_BATCH_GROUPS for the batched tail).
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
 * How a family's catalog SQL is allowed to reach the server.
 *
 *  - `batched` — cheap: its cost is almost entirely round-trip latency, so its
 *    statements are concatenated with other batched families' into ONE
 *    multi-statement round trip (see CATALOG_BATCH_GROUPS).
 *  - `heavy` — measured server/transfer-heavy: always its own round trip, both
 *    so the scheduler can spread the expensive work across streams and so a
 *    `statement_timeout` names the exact query that blew the budget rather than
 *    a batch label.
 *  - `opaque` — not splittable: it BRANCHES on the result of an earlier query of
 *    its own (a permission or existence probe), so its statement list is not
 *    knowable up front. Runs exactly as it always has, on one stream.
 */
type FamilyEntry =
  | (CatalogFamily & { readonly kind: "batched" | "heavy" })
  | {
      readonly kind: "opaque";
      readonly name: string;
      readonly run: (ctx: ExtractContext) => Promise<void>;
    };

const batched = (family: CatalogFamily): FamilyEntry => ({
  kind: "batched",
  ...family,
});
const heavy = (family: CatalogFamily): FamilyEntry => ({
  kind: "heavy",
  ...family,
});
const opaque = (
  name: string,
  run: (ctx: ExtractContext) => Promise<void>,
): FamilyEntry => ({ kind: "opaque", name, run });

/**
 * THE extraction order, and the single source of truth for it: whatever order
 * the families are FETCHED in, their results are merged into `ctx` in exactly
 * this order — which is what makes every execution shape (serial, N streams,
 * batched tail) produce byte-identical facts / edges / diagnostics.
 *
 * Every entry reads nothing another family produced, which is what makes them
 * freely schedulable. The pg_depend resolver is deliberately NOT here: its row
 * post-processing is the one place in the extractor that reads `ctx.facts`, so
 * it is split (SQL half schedulable, processing half deferred to after the merge
 * — see ./dependencies.ts) and always applied last.
 */
const FAMILIES: readonly FamilyEntry[] = [
  batched(rolesAndGrantsFamily),
  batched(schemasAndExtensionsFamily),
  batched(tablesFamily),
  heavy(columnsFamily),
  heavy(tableConstraintsFamily),
  heavy(indexesFamily),
  batched(sequencesFamily),
  batched(viewsFamily),
  heavy(routinesFamily),
  heavy(triggersFamily),
  heavy(policiesFamily),
  batched(domainsFamily),
  batched(typesFamily),
  batched(collationsFamily),
  batched(eventTriggersFamily),
  batched(rulesFamily),
  heavy(aggregatesFamily),
  opaque("foreign", extractForeign),
  batched(publicationsFamily),
  opaque("subscriptions", extractSubscriptions),
  opaque("securityLabels", extractSecurityLabels),
  batched(inheritanceEdgesFamily),
];

/**
 * How the cheap "tail" families are packed into multi-statement round trips.
 *
 * WHY this is safe, and why the grouping is free to be anything: the groups only
 * decide WHERE statements are sent. Each grouped family still gets its OWN
 * collector context, and the collectors are merged in FAMILIES order — so
 * grouping cannot reach the output, exactly as a stream assignment cannot (see
 * ./parallel.ts's slotted-merge argument). Fetch order within one
 * REPEATABLE READ snapshot is output-irrelevant by construction: every family
 * reads the same frozen catalog, and no family reads another's facts.
 *
 * `statement_timeout` is per-STATEMENT inside a multi-statement simple-query
 * batch (verified on PG 17), so batching does not weaken the budget; the only
 * thing it coarsens is the ExtractionTimeoutError LABEL, which is why the
 * expensive families are `heavy` (their own round trip, their own label).
 *
 * Three groups, balanced by statement count (6 / 7 / 5), because balance is what
 * the parallel path wants: one giant group would be a serial tail on a single
 * stream, and one group per family would just be the per-family round trips this
 * exists to remove. Names must be exactly the batched families' `name`s —
 * `resolveBatchGroups` fails loudly at load if they ever drift.
 */
const CATALOG_BATCH_GROUPS: readonly (readonly string[])[] = [
  ["roles", "schemas", "tables"],
  ["sequences", "views", "domains", "types"],
  ["collations", "eventTriggers", "rules", "publications", "inheritance"],
];

/** One grouped family: its canonical FAMILIES index and its split form. */
interface BatchMember {
  readonly index: number;
  readonly family: CatalogFamily;
}

/**
 * Resolve CATALOG_BATCH_GROUPS against FAMILIES once, at load.
 *
 * Every failure mode here is a developer error that would otherwise be SILENT
 * and catastrophic — a batched family left out of every group contributes no
 * facts at all, which reads downstream as "the user dropped those objects". So
 * this refuses to build rather than extract a partial catalog.
 */
function resolveBatchGroups(): readonly (readonly BatchMember[])[] {
  const byName = new Map<string, number>();
  for (const [index, entry] of FAMILIES.entries()) {
    if (byName.has(entry.name)) {
      throw new Error(`duplicate extractor family name "${entry.name}"`);
    }
    byName.set(entry.name, index);
  }
  const grouped = new Set<string>();
  const groups = CATALOG_BATCH_GROUPS.map((names) =>
    names.map((name): BatchMember => {
      const index = byName.get(name);
      if (index === undefined) {
        throw new Error(`catalog batch group names unknown family "${name}"`);
      }
      const entry = FAMILIES[index]!;
      if (entry.kind !== "batched") {
        throw new Error(
          `family "${name}" is ${entry.kind}, not batched — it cannot be grouped`,
        );
      }
      if (grouped.has(name)) {
        throw new Error(`family "${name}" is in more than one catalog batch`);
      }
      grouped.add(name);
      return { index, family: entry };
    }),
  );
  const missing = FAMILIES.filter(
    (entry) => entry.kind === "batched" && !grouped.has(entry.name),
  ).map((entry) => entry.name);
  if (missing.length > 0) {
    throw new Error(
      `batched families missing from every catalog batch: ${missing.join(", ")}`,
    );
  }
  return groups;
}

const BATCH_GROUPS = resolveBatchGroups();

/** Exposed for the unit test that pins the FAMILIES/CATALOG_BATCH_GROUPS
 *  invariants (names, coverage, no duplicates) — see ./extract.test.ts. */
export const catalogBatchPlan = (): {
  families: readonly { name: string; kind: FamilyEntry["kind"] }[];
  groups: readonly (readonly string[])[];
} => ({
  families: FAMILIES.map((entry) => ({ name: entry.name, kind: entry.kind })),
  groups: BATCH_GROUPS.map((group) =>
    group.map((member) => member.family.name),
  ),
});

/** One catalog-query stream: a connection's timeout-aware single-statement
 *  runner and its multi-statement batch runner. Stream 0 is the coordinator. */
interface ExtractStream {
  readonly q: QueryRunner;
  readonly batch: BatchRunner;
}

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
  //
  // Sent through the timeout-aware runner, not the raw client: this round trip
  // runs under the caller's statement_timeout like every other, so a budget
  // that fires HERE must surface as the same ExtractionTimeoutError (via the
  // rethrow below), never as the raw 57014 pg error.
  const settingJitOff = q(jitOffSql(ctx.pgMajor))
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

  // FAMILIES order IS the extraction order: however the families are scheduled
  // and however their statements are packed into round trips, their per-family
  // collectors are merged into `ctx` in that fixed order — which is what makes
  // every execution shape produce byte-identical output (see FAMILIES above).
  const coordinator: ExtractStream = { q: ctx.q, batch };
  if (workers !== undefined && workers.length > 0) {
    try {
      await runFamilies(
        ctx,
        [
          coordinator,
          ...workers.map(
            (worker): ExtractStream => ({
              q: worker.q,
              batch: makeBatchRunner(worker.client, statementTimeoutMs),
            }),
          ),
        ],
        redactSecrets,
      );
    } finally {
      // the coordinator's transaction keeps the snapshot alive, so it stays open
      // (extract() COMMITs long after this) while every worker is closed here
      await closeSnapshotWorkers(workers);
    }
  } else {
    // one stream = the serial path, same plan, same merge
    await runFamilies(ctx, [coordinator], redactSecrets);
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

/** What one scheduled job produced: the canonical family index and that
 *  family's own collector. A batch job fills SEVERAL slots in one go. */
type FilledSlot = readonly [index: number, collector: ExtractContext];

/**
 * Run `FAMILIES` (plus the pg_depend resolver's SQL half) across the given
 * streams — one per connection, `streams[0]` being the coordinator's — then merge
 * the per-family results into `ctx` in FAMILY order.
 *
 * ONE stream is the serial path: `runSlottedJobs` then pulls jobs strictly in
 * index order on a single connection. There is deliberately no separate serial
 * implementation — the two would have to be argued equivalent forever, whereas
 * this way "serial" is just the 1-stream case of the same plan.
 */
async function runFamilies(
  ctx: ExtractContext,
  streams: readonly ExtractStream[],
  redactSecrets: boolean,
): Promise<void> {
  const version: ServerVersionInfo = {
    serverVersion: ctx.serverVersion,
    serverVersionNum: ctx.serverVersionNum,
    pgMajor: ctx.pgMajor,
  };

  // Every family gets its OWN collector, so its output can be slotted by family
  // index; a family that shared a stream's buffers would interleave with
  // whatever else that stream ran.
  const collector = (stream: number): ExtractContext =>
    createCollectorContext(streams[stream]!.q, version, redactSecrets);

  // The pg_depend resolver is the single most expensive query in the
  // extractor. `runSlottedJobs` pulls jobs off this array in INDEX order (see
  // ./parallel.ts's `pull`), so it must be job 0, not the last one — appended
  // after all the family jobs, it would only start once a stream freed up from
  // the rest of the schedule and become a serial tail at low stream counts.
  // Putting it first here changes PULL order only: it fills no family slot
  // (only rows for the post-merge step below), so the merge loop — which is
  // what actually determines fact/edge order — is unaffected by its position.
  let dependRows: readonly Row[] = [];
  const jobs: ((stream: number) => Promise<readonly FilledSlot[]>)[] = [
    async (stream: number): Promise<readonly FilledSlot[]> => {
      dependRows = await fetchDependencyRows({ q: streams[stream]!.q });
      return [];
    },
  ];

  // heavy + opaque families: one job, one family, its own round trip(s).
  for (const [index, entry] of FAMILIES.entries()) {
    if (entry.kind === "batched") continue; // rides in a batch job below
    jobs.push(async (stream: number): Promise<readonly FilledSlot[]> => {
      const own = collector(stream);
      if (entry.kind === "opaque") {
        await entry.run(own);
      } else {
        const rowSets: Row[][] = [];
        // sequential on purpose: one statement per round trip is exactly the
        // pre-batching behavior, including the per-query timeout label
        for (const sql of entry.statements(version)) {
          rowSets.push(await streams[stream]!.q(sql));
        }
        entry.apply(own, rowSets);
      }
      return [[index, own]];
    });
  }

  // the cheap tail: one job per group, one ROUND TRIP per job, N family slots
  for (const group of BATCH_GROUPS) {
    jobs.push(async (stream: number): Promise<readonly FilledSlot[]> => {
      const statements: string[] = [];
      const spans: (BatchMember & { start: number; end: number })[] = [];
      for (const member of group) {
        const own = member.family.statements(version);
        spans.push({
          ...member,
          start: statements.length,
          end: statements.length + own.length,
        });
        appendAll(statements, own);
      }
      const label = `catalog batch (${group.map((m) => m.family.name).join(", ")})`;
      const rowSets = await streams[stream]!.batch(statements, label);
      // A result set per statement, in statement order, is the whole basis for
      // slicing them back apart. If node-pg / the server ever disagreed, the
      // slices would silently shift by one family and half the catalog would
      // vanish from the fact base — so refuse instead of guessing.
      if (rowSets.length !== statements.length) {
        throw new Error(
          `${label} returned ${rowSets.length} result sets for ${statements.length} statements`,
        );
      }
      return spans.map((span): FilledSlot => {
        const own = collector(stream);
        span.family.apply(own, rowSets.slice(span.start, span.end));
        return [span.index, own];
      });
    });
  }

  // The stream count follows the connections we ACTUALLY have, never what was
  // requested: a busy shared pool can yield fewer workers than asked for, and a
  // job scheduled onto a stream with no connection would have no query runner.
  const produced = await runSlottedJobs(jobs, streams.length);

  // Deterministic merge: family order, NEVER completion order and NEVER batch
  // order. This is the whole equivalence argument — see ./parallel.ts.
  const slots = Array.from({
    length: FAMILIES.length,
  }) as (ExtractContext | undefined)[];
  for (const filled of produced) {
    for (const [index, own] of filled) slots[index] = own;
  }
  for (const own of slots) {
    if (own === undefined) continue;
    appendAll(ctx.facts, own.facts);
    appendAll(ctx.edges, own.edges);
    appendAll(ctx.diagnostics, own.diagnostics);
    appendAll(ctx.factDiagnostics, own.factDiagnostics);
  }
  // last, exactly as in the canonical order, and against the MERGED facts (it
  // reads them to decide GENERATED-column shadow edges)
  applyDependencyRows(ctx, dependRows);
}
