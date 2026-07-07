/**
 * Extension handler contract (docs/architecture/extension-intent.md §4.1).
 *
 * A handler is a data package that teaches the integration layer about ONE
 * stateful extension (pg_partman, pgmq, pg_cron, …). It reads the extension's
 * OWN catalogs — `part_config`, `cron.job`, pgmq's `meta`, none of which are
 * `pg_catalog`, so handlers live ABOVE core (P1: capture, never parse) — and
 * emits facts + edges that are merged into the core fact base.
 *
 * The contract lives in the extract layer (not policy/) on purpose: `extract`
 * invokes handlers inside its own snapshot-bound transaction, so it must be able
 * to reference these types WITHOUT importing `policy/` (which already imports
 * `extract`, so the reverse import would be a cycle). Concrete handlers
 * (`pgPartmanHandler`) live in `src/policy/extensions/` and import this type.
 *
 * Phase A (this slice): handlers emit only `managedBy` edges on the objects the
 * extension created operationally, so the managed view (resolveView) projects
 * them out of the schema diff (no data loss). Phase B adds intent facts + replay
 * rules.
 */
import type { Diagnostic } from "../core/diagnostic.ts";
import type { DependencyEdge, Fact, FactBase } from "../core/fact.ts";
import type { IntentKindRule } from "../plan/rules.ts";
import type { Row } from "./scope.ts";

/**
 * The snapshot-bound context handed to a handler's `capture`: a query runner
 * tied to the SAME `REPEATABLE READ READ ONLY` transaction (and the same
 * timeout budget) as core catalog extraction. Handler-produced facts/edges
 * therefore describe the exact same moment in database time as the core facts —
 * the coherent-catalog-read guarantee holds across the integration layer too.
 */
export interface HandlerContext {
  /** Run a query on the core extraction snapshot (timeout-aware, same client). */
  query(sql: string): Promise<Row[]>;
}

export interface CaptureResult {
  /** Intent facts (Phase B). Empty for filter-only handlers. */
  facts: Fact[];
  /** Provenance edges (`managedBy`) marking operationally-created objects. */
  edges: DependencyEdge[];
  /** Diagnostics the capture surfaces — e.g. an unnamed pg_cron job that cannot
   *  be keyed as an intent fact. Rides on the resulting `FactBase.diagnostics`
   *  (so `plan()` can gate on a desired-side "intent-unkeyed" diagnostic) AND on
   *  `ExtractResult.diagnostics` (for CLI rendering). Optional; most captures
   *  emit none. */
  diagnostics?: Diagnostic[];
}

export interface ExtensionHandler {
  /** The `pg_extension` name this handler manages. */
  readonly extension: string;
  /**
   * Read the extension's own catalogs and emit facts + edges. Returns empty
   * when the extension is not installed. Runs on the same snapshot-bound `ctx`
   * as core extraction. Must NOT mutate `current`; it is provided so the handler
   * can target only objects that exist as facts (and avoid dangling edges).
   */
  capture(ctx: HandlerContext, current: FactBase): Promise<CaptureResult>;
  /**
   * Phase B (docs/architecture/extension-intent.md §4.1): replay rules for this
   * handler's intent kinds, keyed by `intentKind` (e.g. `job` for pg_cron). The
   * resolved profile folds these into the plan's rule resolver, so the generic
   * planner dispatches an `extensionIntent` fact exactly like a schema kind.
   * Absent for filter-only Phase-A handlers (pg_partman today), which emit
   * `managedBy` edges but no intent facts.
   */
  readonly intentKinds?: Record<string, IntentKindRule>;
}
