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
import type { AnalyzeOptions, ObjectRef } from "@supabase/pg-topo";
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
 * Split `files` into one-statement units and topologically pre-sort them for
 * shadow loading. Returns single-statement `OrderedSqlFile`s in topo order, each
 * with a zero-padded ordinal `name` prefix and provenance back to the source.
 *
 * @throws {ReorderUnavailableError} when `@supabase/pg-topo` is not installed.
 */
export async function orderForShadow(
  files: SqlFile[],
  options: OrderForShadowOptions = {},
): Promise<OrderedSqlFile[]> {
  if (files.length === 0) {
    return [];
  }

  const { analyzeAndSort } = await loadPgTopo();

  // pg-topo addresses each input by a synthetic `<input:i>` path; map back to
  // the original SqlFile name for provenance.
  const sql = files.map((f) => f.sql);
  const analyzeOptions: AnalyzeOptions | undefined =
    options.externalProviders === undefined
      ? undefined
      : { externalProviders: options.externalProviders };
  const { ordered } = await analyzeAndSort(sql, analyzeOptions);

  // zero-pad ordinals to a fixed width so lexicographic name sort == topo order
  // even past 9 / 99 statements (the loader re-sorts `pending` by name each
  // round). `ordered` is already a total order (pg-topo never drops a statement,
  // including UNKNOWN classes and cycle members), so this is a 1:1 remap.
  const width = String(Math.max(ordered.length - 1, 0)).length;

  return ordered.map((node, index) => {
    const inputIndex = parseInputIndex(node.id.filePath);
    const originalName =
      inputIndex !== null && inputIndex < files.length
        ? (files[inputIndex] as SqlFile).name
        : node.id.filePath;
    const ordinal = String(index).padStart(width, "0");
    const provenance: StatementProvenance = {
      filePath: originalName,
      statementIndex: node.id.statementIndex,
      // omit `sourceOffset` when pg-topo did not resolve it (exactOptionalPropertyTypes)
      ...(node.id.sourceOffset === undefined
        ? {}
        : { sourceOffset: node.id.sourceOffset }),
    };
    return {
      name: `${ordinal}__${originalName}`,
      sql: node.sql,
      provenance,
    };
  });
}

/** Parse the `i` out of pg-topo's synthetic `<input:i>` file path. */
function parseInputIndex(filePath: string): number | null {
  const match = /^<input:(\d+)>$/.exec(filePath);
  return match ? Number.parseInt(match[1] as string, 10) : null;
}
