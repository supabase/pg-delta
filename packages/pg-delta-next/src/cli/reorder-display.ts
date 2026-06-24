/**
 * Display helpers for the statement-reordering assist (`schema apply`).
 *
 * With reorder on, the shadow loader operates on synthetic one-statement files
 * named `<ordinal>__<original path>` (e.g. `0007__schema/users.sql`) and bakes
 * those names into its error strings. These helpers map the synthetic name back
 * to the real authored location — `schema/users.sql:line:col` — so the author
 * sees where the offending statement lives, not an internal ordinal name.
 *
 * Pure formatting / offset resolution — no CLI-framework or fs dependency. The
 * Postgres error text is never altered (D6: PG errors remain authoritative);
 * only the synthetic file name is rewritten.
 */
import { ShadowLoadError } from "../frontends/load-sql-files.ts";
import type {
  OrderedSqlFile,
  StatementProvenance,
} from "../frontends/sql-order.ts";

/** The ordinal prefix `orderForShadow` prepends: digits then `__`. */
const ORDINAL_PREFIX = /^\d+__/;

/** Strip the `<ordinal>__` prefix from a synthetic reorder name. Names that do
 *  not start with the ordinal pattern are returned unchanged. */
export function stripOrdinalPrefix(name: string): string {
  return name.replace(ORDINAL_PREFIX, "");
}

/**
 * Convert a 1-based character offset in `content` to 1-based line and column.
 * (Ported from pg-delta's apply-display.) Used to resolve a statement's byte
 * offset to a human file location.
 */
export function positionToLineColumn(
  content: string,
  position: number,
): { line: number; column: number } {
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLen =
      (lines[i] as string).length + (i < lines.length - 1 ? 1 : 0);
    if (position <= offset + lineLen) {
      return { line: i + 1, column: position - offset };
    }
    offset += lineLen;
  }
  const last = lines.length;
  const lastLineLen = lines[last - 1]?.length ?? 0;
  return { line: last, column: lastLineLen + 1 };
}

/**
 * Render a statement's provenance as `file:line:col` when its source offset and
 * the original file content are both known, else the bare `file` path.
 */
export function formatStatementLocation(
  provenance: StatementProvenance,
  originalContent?: string,
): string {
  if (provenance.sourceOffset !== undefined && originalContent !== undefined) {
    const { line, column } = positionToLineColumn(
      originalContent,
      provenance.sourceOffset + 1,
    );
    return `${provenance.filePath}:${line}:${column}`;
  }
  return provenance.filePath;
}

/**
 * Rewrite a {@link ShadowLoadError} produced while loading reordered files so
 * every synthetic `<ordinal>__<path>` name is replaced by the real source
 * location (`file:line:col`). The Postgres message text is preserved verbatim.
 *
 * `originalSqlByName` maps each ORIGINAL file path (provenance.filePath) to its
 * full content, so statement offsets can be resolved to line:column.
 */
export function rewriteReorderedShadowError(
  error: ShadowLoadError,
  ordered: readonly OrderedSqlFile[],
  originalSqlByName: ReadonlyMap<string, string>,
): ShadowLoadError {
  // longest synthetic names first, so one name can't partially match inside
  // another before the full replacement runs.
  const replacements = [...ordered]
    .sort((a, b) => b.name.length - a.name.length)
    .map((file) => ({
      from: file.name,
      to: formatStatementLocation(
        file.provenance,
        originalSqlByName.get(file.provenance.filePath),
      ),
    }));

  const rewrite = (text: string): string =>
    replacements.reduce((acc, { from, to }) => acc.split(from).join(to), text);

  return new ShadowLoadError(
    rewrite(error.message),
    error.details.map((diagnostic) => ({
      ...diagnostic,
      message: rewrite(diagnostic.message),
    })),
  );
}
