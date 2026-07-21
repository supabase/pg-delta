/**
 * The proof loop (target-architecture §3.7), as a product API.
 * Materialization (template clone / render-from-fact-base) is the caller's
 * concern; this module owns the checks that turn declared safety metadata
 * into VERIFIED claims:
 *   1. state proof — apply, re-extract, zero drift deltas
 *   2. data preservation — pre-seeded rows survive in tables the plan keeps
 *   3. rewrite observation — a relfilenode that changed under an action
 *      that did NOT declare rewriteRisk is a failed proof (§3.7: rewrite
 *      risk is observed on the clone, not certified by the rule)
 */
import type { Pool } from "pg";
import { apply } from "../apply/apply.ts";
import { diff, type Delta } from "../core/diff.ts";
import type { FactBase } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { extract } from "../extract/extract.ts";
import type { Action, Plan } from "../plan/plan.ts";
import { projectTarget } from "../plan/project.ts";
import type { Policy } from "../policy/policy.ts";
import { reconstructManagedView } from "../policy/reconstruct.ts";
import type { ApplierCapability } from "../policy/capability.ts";

/** Structured table identity on the verdict: a collision-free { schema, name }
 *  (NOT a dotted string — identifiers can contain dots, review P2). Consumers
 *  render it with render.ts `rel()` for a properly-quoted, copy-pasteable ref. */
export interface TableRef {
  schema: string;
  name: string;
}

/** The result of best-effort auto-seeding one empty kept table (opt-in via
 *  `ProveOptions.autoSeed`). Taxonomy is by SQLSTATE class, NOT string matching:
 *  - `seeded` — a synthetic `DEFAULT VALUES` row landed; the table now has
 *    content-fingerprint coverage in the data-preservation check.
 *  - `skipped` — no row persisted and that is expected, in two shapes:
 *    (a) the insert hit a class-23 integrity-constraint violation (`reasonCode`
 *    = the SQLSTATE: `23502` NOT NULL w/o default, `23503` FK, `23505` unique,
 *    `23514` check, any `23xxx`); or (b) the insert RESOLVED but the row is
 *    absent from the FINAL pre-apply snapshot — a BEFORE INSERT trigger returned
 *    NULL, a DO INSTEAD rule suppressed it, or an AFTER INSERT trigger deleted it
 *    (possibly while seeding a LATER table). rowCount is only the command tag, so
 *    persistence is judged once by reconciling against that snapshot, not per
 *    insert. This carries the synthetic sentinel `reasonCode` `"no_row"`, the one
 *    skip code that is NOT a SQLSTATE. Either way the table keeps
 *    `contentMode: "none"`.
 *  - `failed` — anything else (a raised exception, connection/syntax/permission
 *    error, or a driver error with no code): a real problem the caller must see
 *    rather than have swallowed. `reasonCode` is the SQLSTATE when the driver
 *    supplied one, and `message` is the error text. */
export type SeedOutcome =
  | { table: TableRef; status: "seeded" }
  | { table: TableRef; status: "skipped"; reasonCode: string }
  | { table: TableRef; status: "failed"; reasonCode?: string; message: string };

export interface DataViolation {
  table: TableRef;
  before: number;
  after: number;
  /** count held but row CONTENT changed on an untouched table (review #3) */
  contentChanged?: boolean;
  /** autoSeed changed the table's schema before the plan ran, so row content
   *  cannot be compared safely (including a table that started empty) */
  schemaChanged?: boolean;
}

export interface SeedStateViolation {
  /** managed-state fingerprint the plan was produced from */
  expectedFingerprint: string;
  /** managed-state fingerprint observed after autoSeed, before plan apply */
  actualFingerprint: string;
}

export interface ProofVerdict {
  ok: boolean;
  applyError?: { actionIndex: number; sql: string; message: string };
  driftDeltas: Delta[];
  /** a kept table whose data changed: row count differs, OR (on a table the
   *  plan did NOT touch) content changed though the count held — drop+recreate
   *  masquerading as preservation, an undeclared destructive operation, or an
   *  autoSeed trigger mutating pre-existing data before the plan ran */
  dataViolations: DataViolation[];
  /** subset of `dataViolations` detected before the plan ran and caused by
   *  autoSeed itself. Present only on that early-failure path so harnesses can
   *  distinguish a seed audit failure from an expected migration failure. */
  seedSideEffects?: DataViolation[];
  /** autoSeed changed extracted managed state before the plan ran (RLS,
   *  constraints, reloptions, replica identity, or any other modeled fact). */
  seedStateViolation?: SeedStateViolation;
  /** a kept table that was physically rewritten (relfilenode changed)
   *  under no action declaring rewriteRisk — the rule under-declared */
  rewriteViolations: Array<{ table: TableRef }>;
  /** what the proof actually verified, per table — honest coverage instead of
   *  a bare boolean (review #3). `ok` is backed by this. */
  coverage: ProofCoverage;
  /** per-table auto-seed outcomes, present ONLY when `options.autoSeed` was set
   *  (seeding runs before the plan is applied, so this is populated even on the
   *  apply-failure early return). Lets a harness tell a genuinely-unseedable
   *  table (`skipped`, class-23) apart from one that failed for a reason nobody
   *  saw (`failed`) instead of both collapsing to `contentMode: "none"`. */
  seedOutcomes?: SeedOutcome[];
}

export interface TableCoverage {
  table: TableRef;
  /** how this table's data was checked:
   *  - "fingerprint": non-empty + untouched by the plan → full content compared
   *  - "count": non-empty but the plan alters it → only row count compared
   *    (a schema change legitimately changes content)
   *  - "none": empty before applying → nothing to check (seed it to get teeth) */
  contentMode: "fingerprint" | "count" | "none";
  recreated: boolean;
  rewriteDeclared: boolean;
  rowsBefore: number;
  rowsAfter: number;
}

export interface ProofCoverage {
  /** tables present before+after and actually compared */
  tablesChecked: number;
  /** tables not compared, with why (recreated/dropped by the plan) */
  tablesSkipped: Array<{ table: TableRef; reason: string }>;
  perTable: TableCoverage[];
}

export interface ProveOptions {
  /** best-effort seed empty kept tables with a synthetic row before
   *  applying, so the data-preservation check has teeth even for scenarios
   *  that ship no seed.sql. Default false (opt-in): enabling it surfaces
   *  populated-table migration hazards, which is a separate audit. */
  autoSeed?: boolean;
  /** how to re-extract the clone after applying. Defaults to the core
   *  `extract`. An integration with extension handlers MUST pass a handler-aware
   *  re-extractor — `extract(pool, { handlers })`, which the resolved profile
   *  supplies as `proveOptions.reextract` — so the proof emits the same
   *  `managedBy` edges and `resolveView` projects out the same managed view it
   *  diffed; otherwise operationally-managed objects (pg_partman children, …)
   *  reappear as drift (docs/architecture/extension-intent.md §6). */
  reextract?: (pool: Pool) => Promise<{ factBase: FactBase }>;
  /** the policy the plan was produced with. The proof must compare the SAME
   *  managed view it diffed, so `resolveView(.., policy)` is applied to both the
   *  re-extracted clone and the target — otherwise policy-scoped objects
   *  (system schemas/roles) reappear as drift (docs/architecture/managed-view-architecture.md). */
  policy?: Policy;
  /** the applier capability the plan was produced with (move 6) — applied to
   *  the proof's view symmetrically so a capability-excluded object (e.g. an
   *  FDW ACL on a non-superuser target) doesn't reappear as drift. */
  capability?: ApplierCapability;
  /** the resolved platform baseline the plan was produced with (§3.9). The
   *  baseline is NOT carried in the plan artifact, so a baseline-shaped plan
   *  must be re-supplied here; otherwise the proof cannot reconstruct the same
   *  view it diffed and fails loudly (P0-2). */
  baseline?: FactBase;
}

interface TableStat {
  rows: number;
  relfilenode: string;
  /** column signature (attname:atttypid, ordered) — content is only comparable
   *  when this is unchanged; a schema change (incl. a column propagated from a
   *  partitioned parent) legitimately changes whole-row text. */
  schemaSig: string;
  /** deterministic content fingerprint, present only for non-empty tables
   *  (md5 over order-independent row text). Undefined ⇒ empty ⇒ not checked. */
  content?: string;
}

const qte = (s: string): string => `"${s.replaceAll('"', '""')}"`;

/** One round trip: every user table's relfilenode + exact row count. */
async function tableStats(pool: Pool): Promise<Map<string, TableStat>> {
  const rels = await pool.query<{
    schema: string;
    name: string;
    relfilenode: string;
    schemasig: string | null;
  }>(`
    SELECT n.nspname AS schema, c.relname AS name,
           c.relfilenode::text AS relfilenode,
           (SELECT string_agg(
                     -- atttypmod captures precision/scale/length (numeric(p,s),
                     -- varchar(n)): a typmod change rewrites stored text
                     -- (9.9 → 9.9000) without changing atttypid, so fold it in
                     -- too — an intentional ALTER COLUMN … TYPE is a schema
                     -- change, not a data mutation.
                     a.attname || ':' || a.atttypid::text || ':'
                       || a.atttypmod::text || ':' || COALESCE((
                       -- a column of a COMPOSITE type changes stored
                       -- representation when the type gains/drops/retypes an
                       -- attribute, even though atttypid is unchanged. Fold the
                       -- composite's attribute signature in so such a change
                       -- flips content to count-only — an additive ALTER TYPE …
                       -- ADD ATTRIBUTE is lossless, not a data mutation (one
                       -- level deep; nested composites are a known gap).
                       SELECT string_agg(
                                ca.attname || ':' || ca.atttypid::text, ','
                                ORDER BY ca.attnum)
                         FROM pg_type ct
                         JOIN pg_class crel ON crel.oid = ct.typrelid
                         JOIN pg_attribute ca ON ca.attrelid = crel.oid
                              AND ca.attnum > 0 AND NOT ca.attisdropped
                        WHERE ct.oid = a.atttypid AND ct.typtype = 'c'
                     ), ''),
                     ',' ORDER BY a.attnum)
              FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attnum > 0
               AND NOT a.attisdropped) AS schemasig
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_%'
    ORDER BY 1, 2`);
  const stats = new Map<string, TableStat>();
  if (rels.rows.length === 0) return stats;
  // a single wide SELECT of all counts avoids the per-table N+1
  const counts = rels.rows
    .map(
      (r, i) =>
        `(SELECT count(*) FROM ${qte(r.schema)}.${qte(r.name)}) AS c${i}`,
    )
    .join(", ");
  const countRow = (await pool.query(`SELECT ${counts}`)).rows[0] as Record<
    string,
    string
  >;
  rels.rows.forEach((r, i) => {
    stats.set(relKey(r.schema, r.name), {
      rows: Number(countRow[`c${i}`]),
      relfilenode: r.relfilenode,
      schemaSig: r.schemasig ?? "",
    });
  });

  // content fingerprints for NON-EMPTY tables only (bounds the cost: empty
  // tables have nothing to fingerprint; large untouched tables are scanned
  // once — proof is an opt-in extra apply+extract). Order-independent so the
  // digest is deterministic regardless of physical row order.
  const nonEmpty = rels.rows.filter((_r, i) => Number(countRow[`c${i}`]) > 0);
  if (nonEmpty.length > 0) {
    const fps = nonEmpty
      .map(
        (r, i) =>
          `(SELECT md5(coalesce(string_agg(x, E'\\n'), '')) ` +
          `FROM (SELECT t::text AS x FROM ${qte(r.schema)}.${qte(r.name)} t ORDER BY 1) q) AS f${i}`,
      )
      .join(", ");
    const fpRow = (await pool.query(`SELECT ${fps}`)).rows[0] as Record<
      string,
      string
    >;
    nonEmpty.forEach((r, i) => {
      const stat = stats.get(relKey(r.schema, r.name));
      const fp = fpRow[`f${i}`];
      if (stat && fp !== undefined) stat.content = fp;
    });
  }
  return stats;
}

/** Collision-free key for a (schema, name) relation: a JSON tuple, NOT a dotted
 *  string — PostgreSQL identifiers can contain dots, so `${schema}.${name}` is
 *  ambiguous (schema "a.b"/table "c" vs schema "a"/table "b.c") and a `.split`
 *  would mis-quote the seed target (review P2). */
export function relKey(schema: string, name: string): string {
  return JSON.stringify([schema, name]);
}
function parseRelKey(key: string): [string, string] {
  return JSON.parse(key) as [string, string];
}

/** The table relation a fact id belongs to, as a relKey, or undefined for ids
 *  that are not table-scoped. */
function tableRelationOf(id: StableId): string | undefined {
  if (id.kind === "table" || id.kind === "materializedView") {
    const t = id as { schema: string; name: string };
    return relKey(t.schema, t.name);
  }
  const t = id as { schema?: string; table?: string };
  if (typeof t.schema === "string" && typeof t.table === "string") {
    return relKey(t.schema, t.table);
  }
  return undefined;
}

function tablesReferencedBy(action: Action): Set<string> {
  const out = new Set<string>();
  for (const id of [
    ...action.produces,
    ...action.consumes,
    ...action.destroys,
  ]) {
    const rel = tableRelationOf(id);
    if (rel !== undefined) out.add(rel);
  }
  return out;
}

async function autoSeedEmptyTables(
  pool: Pool,
  candidates: Iterable<string>,
): Promise<SeedOutcome[]> {
  const outcomes: SeedOutcome[] = [];
  for (const table of candidates) {
    const [schema, name] = parseRelKey(table);
    const ref: TableRef = { schema, name };
    // best-effort: DEFAULT VALUES only succeeds when every column is nullable
    // or defaulted. Classify the failure by SQLSTATE class, not string match:
    // a class-23 integrity-constraint violation (NOT NULL w/o default, FK,
    // unique, check) is an EXPECTED "unseedable" → `skipped`; anything else (a
    // raised exception, connection/syntax/permission error, unknown) is a real
    // problem → `failed`, so it can't hide behind `contentMode: "none"`.
    try {
      await pool.query(
        `INSERT INTO ${qte(schema)}.${qte(name)} DEFAULT VALUES`,
      );
      // PROVISIONAL: a resolved insert is NOT proof of a persisted row, and
      // rowCount is only the command tag. Persistence is judged once, later, by
      // reconcileSeedOutcomes against the single FINAL pre-apply snapshot — that
      // catches same-table suppression (BEFORE trigger → NULL), same-table undo
      // (AFTER trigger delete), AND cross-table undo (seeding a LATER table
      // deletes THIS row), which no per-insert probe can see. A row that ends
      // that snapshot gone is downgraded to skipped("no_row").
      outcomes.push({ table: ref, status: "seeded" });
    } catch (err) {
      const rawCode = (err as { code?: unknown }).code;
      const code = typeof rawCode === "string" ? rawCode : undefined;
      if (code !== undefined && code.startsWith("23")) {
        outcomes.push({ table: ref, status: "skipped", reasonCode: code });
      } else {
        outcomes.push({
          table: ref,
          status: "failed",
          ...(code !== undefined ? { reasonCode: code } : {}),
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return outcomes;
}

/**
 * Reconcile provisional `seeded` outcomes against the FINAL pre-apply table
 * snapshot: a synthetic row that no longer exists there (a trigger/rule
 * suppressed or deleted it — possibly while seeding a LATER table) was never
 * really seeded, so downgrade it to `skipped("no_row")`. One source of truth
 * for persistence; `skipped`/`failed` outcomes are already terminal and pass
 * through unchanged. Pure (no DB) — unit-testable. (`no_row` is the one
 * non-SQLSTATE skip reasonCode; see SeedOutcome.)
 */
export function reconcileSeedOutcomes(
  outcomes: SeedOutcome[],
  finalStats: Map<string, TableStat>,
): SeedOutcome[] {
  return outcomes.map((o) => {
    if (o.status !== "seeded") return o;
    const stat = finalStats.get(relKey(o.table.schema, o.table.name));
    return stat !== undefined && stat.rows === 0
      ? { table: o.table, status: "skipped", reasonCode: "no_row" }
      : o;
  });
}

/**
 * Build the data-proof baseline after auto-seeding without letting seed-trigger
 * side effects erase the source data we meant to protect:
 *  - tables that were already populated stay anchored to their PRE-seed stats;
 *  - tables that were empty use the FINAL post-seed stats, so a surviving
 *    synthetic row gives the proof content coverage;
 *  - post-seed-only tables pass through defensively (state proof owns them).
 *
 * `autoSeedEmptyTables` can fire arbitrary user triggers. A trigger on an empty
 * candidate may update/delete a different, populated table; using only the
 * post-seed snapshot would silently accept that damage as the proof baseline.
 */
export function composeAutoSeedBaseline(
  preSeed: Map<string, TableStat>,
  postSeed: Map<string, TableStat>,
): Map<string, TableStat> {
  const baseline = new Map(postSeed);
  for (const [table, stat] of preSeed) {
    if (stat.rows > 0) baseline.set(table, stat);
  }
  return baseline;
}

/**
 * Detect autoSeed side effects while pre/post fingerprints are directly
 * comparable: no plan action has run between these snapshots. Schema is
 * protected for every kept table; row/content changes are protected only for
 * populated tables because originally-empty tables are expected to gain a
 * synthetic row. Recreated tables carry no data-preservation claim.
 */
export function detectAutoSeedSideEffects(
  preSeed: Map<string, TableStat>,
  postSeed: Map<string, TableStat>,
  recreatedTables: Set<string>,
): ProofVerdict["dataViolations"] {
  const violations: ProofVerdict["dataViolations"] = [];
  for (const [table, before] of preSeed) {
    if (recreatedTables.has(table)) continue;
    const [schema, name] = parseRelKey(table);
    const ref: TableRef = { schema, name };
    const after = postSeed.get(table);
    if (before.rows === 0) {
      if (after === undefined || after.schemaSig !== before.schemaSig) {
        violations.push({
          table: ref,
          before: 0,
          after: after?.rows ?? 0,
          schemaChanged: true,
        });
      }
      continue;
    }
    if (after === undefined || after.rows !== before.rows) {
      violations.push({
        table: ref,
        before: before.rows,
        after: after?.rows ?? 0,
      });
    } else if (after.schemaSig !== before.schemaSig) {
      // No plan action has run yet: unlike the final proof comparison, there is
      // no legitimate schema transition to tolerate between these snapshots.
      violations.push({
        table: ref,
        before: before.rows,
        after: after.rows,
        schemaChanged: true,
      });
    } else if (
      before.content !== undefined &&
      after.content !== undefined &&
      before.content !== after.content
    ) {
      violations.push({
        table: ref,
        before: before.rows,
        after: after.rows,
        contentChanged: true,
      });
    }
  }
  return violations;
}

/**
 * Pure verdict logic over before/after table stats (testable without a DB).
 *
 * For every table present before applying:
 *  - recreated/dropped by the plan → skipped (changes are expected), reported
 *  - row count changed → data violation
 *  - count held but CONTENT changed while the SCHEMA SIGNATURE is unchanged →
 *    data violation (genuine data mutation; if the schema changed — e.g. a
 *    column propagated from a partitioned parent — content is not comparable,
 *    so only the count is trusted)
 *  - relfilenode changed with no rewriteRisk-declaring action → rewrite
 *    violation
 * and emits an honest per-table coverage report (review #3).
 */
export function detectViolations(
  before: Map<string, TableStat>,
  after: Map<string, TableStat>,
  ctx: {
    recreatedTables: Set<string>;
    declaredRewriteTables: Set<string>;
    /** oldRelKey → newRelKey for accepted table renames. The data lives under
     *  the NEW key in `after`, so a renamed table is compared before(old) vs
     *  after(new) instead of being skipped as "dropped/recreated" (F7). Empty /
     *  absent ⇒ behavior is byte-identical to the non-rename path. */
    renamedTables?: Map<string, string>;
  },
): {
  dataViolations: ProofVerdict["dataViolations"];
  rewriteViolations: ProofVerdict["rewriteViolations"];
  coverage: ProofCoverage;
} {
  const dataViolations: ProofVerdict["dataViolations"] = [];
  const rewriteViolations: ProofVerdict["rewriteViolations"] = [];
  const perTable: TableCoverage[] = [];
  const tablesSkipped: ProofCoverage["tablesSkipped"] = [];

  for (const [table, beforeStat] of before) {
    // `table` is the collision-free relKey the before/after maps are keyed by.
    // For an accepted rename the data now lives under the NEW key in `after`, so
    // resolve the after-side key through the rename map (identity otherwise).
    const afterKey = ctx.renamedTables?.get(table) ?? table;
    // The verdict carries the parsed { schema, name } so consumers never re-parse
    // a JSON/dotted string (render with render.ts `rel()` for display). Use the
    // AFTER key: for a rename that is the NEW name (where the data lives now);
    // for every other table afterKey === table, so this is unchanged.
    const [schema, name] = parseRelKey(afterKey);
    const ref: TableRef = { schema, name };
    const afterStat = after.get(afterKey);
    if (afterStat === undefined) {
      tablesSkipped.push({ table: ref, reason: "dropped by the plan" });
      continue;
    }
    if (ctx.recreatedTables.has(table)) {
      tablesSkipped.push({ table: ref, reason: "recreated by the plan" });
      continue;
    }

    const schemaStable = beforeStat.schemaSig === afterStat.schemaSig;
    if (afterStat.rows !== beforeStat.rows) {
      dataViolations.push({
        table: ref,
        before: beforeStat.rows,
        after: afterStat.rows,
      });
    } else if (
      schemaStable &&
      beforeStat.content !== undefined &&
      afterStat.content !== undefined &&
      beforeStat.content !== afterStat.content
    ) {
      dataViolations.push({
        table: ref,
        before: beforeStat.rows,
        after: afterStat.rows,
        contentChanged: true,
      });
    }

    if (
      afterStat.relfilenode !== beforeStat.relfilenode &&
      !ctx.declaredRewriteTables.has(table)
    ) {
      rewriteViolations.push({ table: ref });
    }

    const contentMode: TableCoverage["contentMode"] =
      beforeStat.content === undefined
        ? "none"
        : schemaStable
          ? "fingerprint"
          : "count";
    perTable.push({
      table: ref,
      contentMode,
      recreated: false,
      rewriteDeclared: ctx.declaredRewriteTables.has(table),
      rowsBefore: beforeStat.rows,
      rowsAfter: afterStat.rows,
    });
  }

  return {
    dataViolations,
    rewriteViolations,
    coverage: { tablesChecked: perTable.length, tablesSkipped, perTable },
  };
}

/**
 * Prove a plan against a sacrificial clone of the source. The clone is
 * mutated; never pass a real target.
 */
export async function provePlan(
  thePlan: Plan,
  clonePool: Pool,
  desired: FactBase,
  options: ProveOptions = {},
): Promise<ProofVerdict> {
  // tables the plan tears down (drop or replace) are NOT "kept"; relfilenode
  // and row-count changes on them are expected, not violations
  const recreatedTables = new Set<string>();
  const declaredRewriteTables = new Set<string>();
  for (const action of thePlan.actions) {
    for (const id of action.destroys) {
      const rel = tableRelationOf(id);
      if (
        rel !== undefined &&
        (id.kind === "table" || id.kind === "materializedView")
      )
        recreatedTables.add(rel);
    }
    if (action.rewriteRisk) {
      for (const rel of tablesReferencedBy(action))
        declaredRewriteTables.add(rel);
    }
  }

  // Accepted table renames: the rename action destroys the OLD subtree (so the
  // old relKey landed in `recreatedTables` above), but the table is KEPT — its
  // data just moved to the NEW name. Map old→new for the proof and un-mark the
  // old key as recreated, so the renamed table is compared before(old) vs
  // after(new) instead of being silently skipped (F7).
  const renamedTables = new Map<string, string>();
  for (const r of thePlan.acceptedRenames ?? []) {
    if (
      (r.from.kind === "table" || r.from.kind === "materializedView") &&
      (r.to.kind === "table" || r.to.kind === "materializedView")
    ) {
      const from = tableRelationOf(r.from);
      const to = tableRelationOf(r.to);
      if (from !== undefined && to !== undefined) renamedTables.set(from, to);
    }
  }
  for (const from of renamedTables.keys()) recreatedTables.delete(from);

  // Reconstruct the exact managed view the plan fingerprinted. The same helper
  // serves both the post-autoSeed pre-apply guard and the final convergence
  // proof, so policy/capability/baseline/scope cannot drift between them.
  const policy = options.policy ?? thePlan.policy;
  const capability = options.capability ?? thePlan.capability;
  if (policy?.baseline !== undefined && options.baseline === undefined) {
    throw new Error(
      `provePlan: plan was produced with policy "${policy.id}" declaring baseline ` +
        `"${policy.baseline}", but no baseline was supplied; pass the resolved baseline ` +
        `as options.baseline so the proof compares the same view the plan diffed.`,
    );
  }
  const viewOpts = {
    policy,
    capability,
    baseline: options.baseline,
    scope: thePlan.scope,
    defaultOwner: thePlan.defaultOwner,
  };
  const reextractClone = (): Promise<{ factBase: FactBase }> =>
    options.reextract
      ? options.reextract(clonePool)
      : extract(clonePool, { redactSecrets: thePlan.redactSecrets ?? true });
  const managedView = (factBase: FactBase): FactBase =>
    reconstructManagedView(factBase, viewOpts);

  // populated only when autoSeed ran, so it stays out of the verdict entirely
  // on the default opt-out path (present ⇒ autoSeed was requested).
  let seedOutcomes: SeedOutcome[] | undefined;
  let preSeedStats: Map<string, TableStat> | undefined;
  if (options.autoSeed) {
    preSeedStats = await tableStats(clonePool);
    const empty = [...preSeedStats]
      .filter(([t, s]) => s.rows === 0 && !recreatedTables.has(t))
      .map(([t]) => t);
    seedOutcomes = await autoSeedEmptyTables(clonePool, empty);
  }

  const postSeedStats = await tableStats(clonePool);
  // reconcile provisional seeds against `postSeedStats` — the single FINAL pre-apply
  // snapshot (taken after ALL seeding), so a row later suppressed/undone by a
  // trigger or rule (even cross-table) is downgraded to skipped("no_row").
  if (seedOutcomes !== undefined) {
    seedOutcomes = reconcileSeedOutcomes(seedOutcomes, postSeedStats);
  }
  const seedSideEffects =
    preSeedStats === undefined
      ? []
      : detectAutoSeedSideEffects(preSeedStats, postSeedStats, recreatedTables);
  // Do not apply a plan to a clone whose pre-existing data autoSeed already
  // changed. Capturing the violation now, while schemas are still comparable,
  // prevents a later legitimate schema change from suppressing the content
  // comparison and producing a false-green proof.
  if (seedSideEffects.length > 0) {
    return {
      ok: false,
      driftDeltas: [],
      dataViolations: seedSideEffects,
      seedSideEffects,
      rewriteViolations: [],
      coverage: { tablesChecked: 0, tablesSkipped: [], perTable: [] },
      ...(seedOutcomes !== undefined ? { seedOutcomes } : {}),
    };
  }
  // Table stats deliberately cover data and column representation only. A seed
  // trigger can also change any other modeled state (RLS, constraints,
  // reloptions, replica identity, comments, roles, ...). Re-extract the same
  // managed view the plan fingerprinted and require it to remain the source
  // state before applying anything. Row inserts do not affect the fact base.
  if (preSeedStats !== undefined) {
    const postSeedState = managedView((await reextractClone()).factBase);
    if (postSeedState.rootHash !== thePlan.source.fingerprint) {
      return {
        ok: false,
        driftDeltas: [],
        dataViolations: [],
        seedStateViolation: {
          expectedFingerprint: thePlan.source.fingerprint,
          actualFingerprint: postSeedState.rootHash,
        },
        rewriteViolations: [],
        coverage: { tablesChecked: 0, tablesSkipped: [], perTable: [] },
        ...(seedOutcomes !== undefined ? { seedOutcomes } : {}),
      };
    }
  }
  // Synthetic rows need the post-seed snapshot, but data that existed before
  // autoSeed must stay anchored to the pre-seed snapshot. Otherwise a trigger
  // fired by seeding one empty table can mutate a populated table and have that
  // damage silently accepted as the proof baseline.
  const before =
    preSeedStats === undefined
      ? postSeedStats
      : composeAutoSeedBaseline(preSeedStats, postSeedStats);
  // the proof re-extracts after applying anyway; the fingerprint gate's
  // extra extraction is redundant here (it has its own execution tests)
  const report = await apply(thePlan, clonePool, { fingerprintGate: false });
  if (report.status !== "applied") {
    return {
      ok: false,
      ...(report.error ? { applyError: report.error } : {}),
      driftDeltas: [],
      dataViolations: [],
      rewriteViolations: [],
      coverage: { tablesChecked: 0, tablesSkipped: [], perTable: [] },
      // seeding already happened before apply, so report it even on this
      // early return (the caller's coverage gate still wants to see it).
      ...(seedOutcomes !== undefined ? { seedOutcomes } : {}),
    };
  }
  // same redaction mode the plan was fingerprinted with (Plan.redactSecrets,
  // default true) — otherwise the proven clone comes back placeholder-redacted
  // while `desired` (passed in already extracted with redactSecrets:false)
  // still carries real secrets, and the comparison below reports a spurious
  // drift delta though nothing actually diverged. A custom `reextract` is
  // trusted to already bake in the right mode.
  const proven = await reextractClone();
  // Compare the SAME managed view the plan diffed: resolveView projects out
  // extension members + the policy's scope rules at the fact level, on BOTH the
  // proven clone and the target — otherwise an extension's internals or a
  // policy-scoped object (system schema/role) read as drift
  // (docs/architecture/managed-view-architecture.md). With no policy this is exactly the
  // extension-member projection, so the corpus proof is unchanged.
  // policy + capability default to the values the plan was produced with (both
  // are inlined on the plan artifact), so a separate `prove` invocation recovers
  // the exact same view without the caller re-supplying them.
  // Reconstruct the same managed view on both sides through the shared helper.
  const provenFb = managedView(proven.factBase);
  // target the PROJECTED desired: the plan only applies kept deltas, so it
  // converges to `desired` minus the policy-filtered changes (review #2).
  const target = managedView(projectTarget(desired, thePlan.filteredDeltas));
  const driftDeltas = diff(provenFb, target);
  const after = await tableStats(clonePool);

  const { dataViolations, rewriteViolations, coverage } = detectViolations(
    before,
    after,
    { recreatedTables, declaredRewriteTables, renamedTables },
  );

  return {
    ok:
      driftDeltas.length === 0 &&
      dataViolations.length === 0 &&
      rewriteViolations.length === 0,
    driftDeltas,
    dataViolations,
    rewriteViolations,
    coverage,
    ...(seedOutcomes !== undefined ? { seedOutcomes } : {}),
  };
}
