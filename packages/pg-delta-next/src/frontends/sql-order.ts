/**
 * Statement-reordering assist for shadow loading (target-architecture §4.4.1).
 *
 * This is the OPT-IN enhancement layered above the parser-free core loader
 * ([`load-sql-files.ts`](./load-sql-files.ts)). It splits the user's SQL files
 * into one-statement units and topologically pre-sorts them via `@supabase/pg-topo`
 * so the loader's defer-and-retry rounds converge faster and deterministically.
 *
 * Trust posture (the whole reason this lives in its own subpath):
 * - The assist is **advisory**. Correctness comes from the split + the shadow's
 *   real Postgres rounds, never from trusting pg-topo's order (principle P1):
 *   the worst it can do is fail to build the shadow — a visible error BEFORE
 *   extraction — it can never corrupt the extracted desired state.
 * - The core lib and `loadSqlFiles` MUST stay parser-free / WASM-free. So
 *   `@supabase/pg-topo` is imported with a **guarded dynamic `import()`** and is
 *   declared an `optionalPeerDependency`. Merely importing the core never pulls
 *   the WASM parser; only calling into this subpath does.
 *
 * Structural guarantees (D4):
 * - exactly one statement per output `SqlFile`, so the existing `loadSqlFiles`
 *   becomes statement-granular with zero core change;
 * - a zero-padded ordinal `name` prefix (`0007__schema/users.sql`) so the
 *   loader's per-round lexicographic `name` sort reproduces topo order;
 * - every input statement preserved **exactly once** — including statements
 *   pg-topo classes as `UNKNOWN` and statements trapped in a cycle (pg-topo's
 *   `ordered` is a total order, so cycle members arrive at a best-effort
 *   position rather than being dropped);
 * - statement text carried **verbatim**;
 * - **deterministic** output for the same input.
 */
import type { AnalyzeOptions, ObjectRef, StatementId } from "@supabase/pg-topo";
import type { SqlFile } from "./load-sql-files.ts";

/** Provenance back to the authored source, so a caller can render
 *  `schema/users.sql:line:col` after stripping the ordinal name prefix. */
export interface StatementProvenance {
  /** The original `SqlFile.name` this statement came from. */
  filePath: string;
  /** Index of the statement within its original file (0-based). */
  statementIndex: number;
  /** Byte offset of the statement in the original file content, when pg-topo
   *  resolves it (used for line:column rendering). */
  sourceOffset?: number;
}

/** A single-statement `SqlFile` carrying provenance. Assignable to `SqlFile`,
 *  so the array can be fed straight into `loadSqlFiles` — the loader reads only
 *  `name`/`sql` and is blind to the extra field (and to whether input was
 *  sorted at all). */
export interface OrderedSqlFile extends SqlFile {
  provenance: StatementProvenance;
}

export interface OrderForShadowOptions {
  /** Objects the shadow already provides (e.g. extension-owned), passed through
   *  to pg-topo so they are not flagged as unresolved. Optional; the lowest-risk
   *  default is none — round-retry + diagnostics handle externals. */
  externalProviders?: ObjectRef[];
}

/**
 * A shadow-load cycle the assist statically detected (e.g. inline mutual FK).
 * Advisory only — the assist never decides correctness; this is annotation a
 * caller can attach to a real (Postgres-driven) stuck error (D6).
 */
export interface ShadowLoadCycle {
  /** The statements forming the cycle, in cycle order, mapped back to source. */
  members: StatementProvenance[];
  /** pg-topo object keys involved in the cycle (e.g. `table:public.a`), if any. */
  objectKeys: string[];
}

/** Result of analyzing files for shadow loading: the reordered single-statement
 *  files plus any statically-detected shadow-load cycles. */
export interface ShadowOrderResult {
  files: OrderedSqlFile[];
  cycles: ShadowLoadCycle[];
}

/**
 * Thrown when the reordering assist is invoked but `@supabase/pg-topo` is not
 * installed. Carries the exact install command plus the escape hatch (call
 * `loadSqlFiles` directly for raw file-granular loading).
 */
export class ReorderUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      "The statement reordering assist requires the optional peer " +
        "'@supabase/pg-topo', which is not installed. Install it with " +
        "`pnpm add @supabase/pg-topo` (or `bun add @supabase/pg-topo`), or call " +
        "`loadSqlFiles` directly to load SQL files at file granularity without " +
        "reordering.",
    );
    this.name = "ReorderUnavailableError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

type PgTopoModule = typeof import("@supabase/pg-topo");

/** The dynamic importer, behind an indirection so tests can simulate the
 *  pg-topo-absent path without uninstalling the workspace dependency. */
let importPgTopo: () => Promise<PgTopoModule> = () =>
  import("@supabase/pg-topo");

/**
 * @internal Test-only seam. Pass an importer that rejects/throws to exercise the
 * degradation path; pass `null` to restore the real dynamic `import()`.
 */
export function __setPgTopoImporterForTests(
  importer: (() => Promise<PgTopoModule>) | null,
): void {
  importPgTopo = importer ?? (() => import("@supabase/pg-topo"));
}

async function loadPgTopo(): Promise<PgTopoModule> {
  try {
    return await importPgTopo();
  } catch (cause) {
    throw new ReorderUnavailableError(cause);
  }
}

/**
 * Resolve whether the reordering assist can run (i.e. `@supabase/pg-topo` is
 * importable). Lets a caller that prefers silent fallback probe instead of
 * catching `ReorderUnavailableError`.
 */
export async function canReorder(): Promise<boolean> {
  try {
    await loadPgTopo();
    return true;
  } catch {
    return false;
  }
}

/**
 * Analyze `files` for shadow loading: split them into one-statement units,
 * topologically pre-sort them, and surface any statically-detected shadow-load
 * cycles. Returns the reordered single-statement `OrderedSqlFile`s (each with a
 * zero-padded ordinal `name` prefix and provenance) plus the cycles.
 *
 * Both outputs are advisory — Postgres still elaborates the shadow (P1). The
 * cycles let a caller annotate a real (Postgres-driven) stuck load (D6).
 *
 * @throws {ReorderUnavailableError} when `@supabase/pg-topo` is not installed.
 */
export async function analyzeForShadow(
  files: SqlFile[],
  options: OrderForShadowOptions = {},
): Promise<ShadowOrderResult> {
  if (files.length === 0) {
    return { files: [], cycles: [] };
  }

  const { analyzeAndSort } = await loadPgTopo();

  // pg-topo addresses each input by a synthetic `<input:i>` path; map back to
  // the original SqlFile name for provenance.
  const sql = files.map((f) => f.sql);
  const analyzeOptions: AnalyzeOptions | undefined =
    options.externalProviders === undefined
      ? undefined
      : { externalProviders: options.externalProviders };
  const { ordered, diagnostics, graph } = await analyzeAndSort(
    sql,
    analyzeOptions,
  );

  const toProvenance = (id: StatementId): StatementProvenance => {
    const inputIndex = parseInputIndex(id.filePath);
    const originalName =
      inputIndex !== null && inputIndex < files.length
        ? (files[inputIndex] as SqlFile).name
        : id.filePath;
    return {
      filePath: originalName,
      statementIndex: id.statementIndex,
      // omit `sourceOffset` when pg-topo did not resolve it (exactOptionalPropertyTypes)
      ...(id.sourceOffset === undefined
        ? {}
        : { sourceOffset: id.sourceOffset }),
    };
  };

  // zero-pad ordinals to a fixed width so lexicographic name sort == topo order
  // even past 9 / 99 statements (the loader re-sorts `pending` by name each
  // round). `ordered` is already a total order (pg-topo never drops a statement,
  // including UNKNOWN classes and cycle members), so this is a 1:1 remap.
  const width = String(Math.max(ordered.length - 1, 0)).length;
  const orderedFiles: OrderedSqlFile[] = ordered.map((node, index) => {
    const provenance = toProvenance(node.id);
    const ordinal = String(index).padStart(width, "0");
    return {
      name: `${ordinal}__${provenance.filePath}`,
      sql: node.sql,
      provenance,
    };
  });

  // map pg-topo's cycle groups (statement ids, in cycle order) to provenance,
  // pulling the object keys from the matching CYCLE_DETECTED diagnostic.
  const cycleDiagnostics = diagnostics.filter(
    (d) => d.code === "CYCLE_DETECTED",
  );
  const cycles: ShadowLoadCycle[] = graph.cycleGroups.map((group) => {
    const head = group[0];
    const diagnostic = cycleDiagnostics.find(
      (d) =>
        d.statementId !== undefined &&
        head !== undefined &&
        d.statementId.filePath === head.filePath &&
        d.statementId.statementIndex === head.statementIndex,
    );
    const objectKeys = diagnostic?.details?.["cycleObjectKeys"];
    return {
      members: group.map(toProvenance),
      objectKeys: Array.isArray(objectKeys)
        ? objectKeys.filter((k): k is string => typeof k === "string")
        : [],
    };
  });

  return { files: orderedFiles, cycles };
}

/**
 * Split `files` into one-statement units and topologically pre-sort them for
 * shadow loading. Returns single-statement `OrderedSqlFile`s in topo order, each
 * with a zero-padded ordinal `name` prefix and provenance back to the source.
 *
 * Thin wrapper over {@link analyzeForShadow} for callers that only need the
 * files (the statically-detected cycles are discarded).
 *
 * @throws {ReorderUnavailableError} when `@supabase/pg-topo` is not installed.
 */
export async function orderForShadow(
  files: SqlFile[],
  options: OrderForShadowOptions = {},
): Promise<OrderedSqlFile[]> {
  return (await analyzeForShadow(files, options)).files;
}

/** Parse the `i` out of pg-topo's synthetic `<input:i>` file path. */
function parseInputIndex(filePath: string): number | null {
  const match = /^<input:(\d+)>$/.exec(filePath);
  return match ? Number.parseInt(match[1] as string, 10) : null;
}
