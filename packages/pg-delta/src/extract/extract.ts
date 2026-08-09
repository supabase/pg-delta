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
 * connection — consistent by construction. (Parallel workers via
 * `pg_export_snapshot()` are a later optimization; serial is the documented
 * fallback and plenty fast at current scale.)
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
  extractDependencyEdges,
  extractInheritanceEdges,
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
  createExtractContext,
  ExtractionTimeoutError,
  pruneOrphanedSatellites,
} from "./scope.ts";
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
}

export async function extract(
  pool: Pool,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    // Canonicalize the deparse path (pg_dump convention, post-CVE-2018-1058):
    // `format_type` and every `pg_get_*def` / `pg_get_expr` path-relativizes
    // names, so anything visible on the session `search_path` comes back
    // UNQUALIFIED. Pinning to `pg_catalog` forces every non-catalog reference to
    // be schema-qualified, so the SAME catalog hashes identically regardless of
    // the database's / role's / connection's default path. SET LOCAL scopes it
    // to this transaction and is discarded on COMMIT/ROLLBACK, so pooled
    // connections are untouched.
    await client.query("SET LOCAL search_path TO 'pg_catalog'");
    // Opt-in per-statement budget: a runaway catalog query on a pathological
    // schema aborts with an actionable ExtractionTimeoutError (see scope.ts q())
    // instead of hanging. Default is unlimited — never abort a legitimate
    // large extraction unless the caller asked for a budget.
    if (options.statementTimeoutMs !== undefined) {
      await client.query(
        `SET LOCAL statement_timeout = ${Math.max(0, Math.floor(options.statementTimeoutMs))}`,
      );
    }
    const result = await extractOnClient(
      client,
      options.source ?? "liveDb",
      options.statementTimeoutMs,
      options.handlers ?? [],
      options.redactSecrets ?? true,
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
): Promise<ExtractResult> {
  const ctx = await createExtractContext(
    client,
    statementTimeoutMs,
    redactSecrets,
  );

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
  await client.query(
    ctx.pgMajor >= 15
      ? "SELECT set_config('jit', 'off', true) WHERE has_parameter_privilege(current_user, 'jit', 'SET')"
      : "SET LOCAL jit = off",
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

  // The call order IS the extraction order: facts / edges / diagnostics are
  // accumulated in `ctx` in the order these run, so this sequence is preserved
  // exactly from the pre-split single-function extractor.
  await extractRolesAndGrants(ctx);
  await extractSchemasAndExtensions(ctx);
  await extractTables(ctx);
  await extractColumns(ctx);
  await extractTableConstraints(ctx);
  await extractIndexes(ctx);
  await extractSequences(ctx);
  await extractViews(ctx);
  await extractRoutines(ctx);
  await extractTriggers(ctx);
  await extractPolicies(ctx);
  await extractDomains(ctx);
  await extractTypes(ctx);
  await extractCollations(ctx);
  await extractEventTriggers(ctx);
  await extractRules(ctx);
  await extractAggregates(ctx);
  await extractForeign(ctx);
  await extractPublications(ctx);
  await extractSubscriptions(ctx);
  await extractSecurityLabels(ctx);
  await extractInheritanceEdges(ctx);
  await extractDependencyEdges(ctx);

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
