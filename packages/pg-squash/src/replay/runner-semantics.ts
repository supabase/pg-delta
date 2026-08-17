const BOM = 0xfeff;
const PG_DELTA_NO_TRANSACTION = "-- pg-delta: transaction=false";

const CREATE_INDEX_CONCURRENTLY =
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY(?:\s|$)/u;
const REINDEX_CONCURRENTLY = /^REINDEX(?:\s|\().*\sCONCURRENTLY(?:\s|$)/u;
const VACUUM = /^VACUUM(?:\s|\(|$)/u;
const ALTER_SYSTEM = /^ALTER\s+SYSTEM(?:\s|$)/u;
const CLUSTER = /^CLUSTER(?:\s|$)/u;
const TRANSACTION_CONTROL =
  /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ABORT|PREPARE\s+TRANSACTION)(?:\s|$)/u;

/**
 * Strip a leading BOM, whitespace, and SQL line/block comments so keyword
 * checks see the first real token. Port of CLI `legacyTrimLeadingSqlComments`.
 */
export const trimLeadingSqlComments = (sql: string): string => {
  let trimmed = sql.replace(/^[ \t\n\r]+/u, "");
  while (trimmed.charCodeAt(0) === BOM) {
    trimmed = trimmed.slice(1).replace(/^[ \t\n\r]+/u, "");
  }
  for (;;) {
    if (trimmed.startsWith("--")) {
      const idx = trimmed.indexOf("\n");
      if (idx < 0) return "";
      trimmed = trimmed.slice(idx + 1).replace(/^[ \t\n\r]+/u, "");
    } else if (trimmed.startsWith("/*")) {
      const idx = trimmed.indexOf("*/");
      if (idx < 0) return trimmed;
      trimmed = trimmed.slice(idx + 2).replace(/^[ \t\n\r]+/u, "");
    } else {
      return trimmed.trim();
    }
  }
};

/** CLI splitter strips trailing `;`; pg-topo keeps it. Normalize before match. */
const statementHead = (sql: string): string =>
  trimLeadingSqlComments(sql).replace(/;\s*$/u, "").toUpperCase();

/**
 * Statements the CLI runs outside `BEGIN`/`COMMIT` (supabase/cli#5156).
 */
export const isPipelineIncompatible = (sql: string): boolean => {
  const upper = statementHead(sql);
  return (
    CREATE_INDEX_CONCURRENTLY.test(upper) ||
    REINDEX_CONCURRENTLY.test(upper) ||
    VACUUM.test(upper) ||
    ALTER_SYSTEM.test(upper) ||
    CLUSTER.test(upper)
  );
};

/**
 * Authored transaction boundaries that must not be nested in the CLI wrapper.
 * `ROLLBACK TO [SAVEPOINT]` is not control — it rewinds the current txn.
 */
export const hasTransactionControl = (sql: string): boolean => {
  const upper = statementHead(sql);
  const words = upper.split(/\s+/u);
  if (words[0] === "ROLLBACK") {
    const toIndex = words[1] === "WORK" || words[1] === "TRANSACTION" ? 2 : 1;
    return words[toIndex] !== "TO";
  }
  return TRANSACTION_CONTROL.test(upper);
};

/**
 * File-level transaction mode. Only an exact first-line
 * `-- pg-delta: transaction=false` (optional BOM / CRLF) disables wrapping.
 */
export const parseTransactionMode = (sql: string): "transactional" | "none" => {
  const withoutBom = sql.charCodeAt(0) === BOM ? sql.slice(1) : sql;
  const firstNewline = withoutBom.indexOf("\n");
  const rawFirstLine =
    firstNewline < 0 ? withoutBom : withoutBom.slice(0, firstNewline);
  const firstLine = rawFirstLine.endsWith("\r")
    ? rawFirstLine.slice(0, -1)
    : rawFirstLine;
  return firstLine === PG_DELTA_NO_TRANSACTION ? "none" : "transactional";
};

export type ReplayBatch =
  | { kind: "txn"; statements: string[] }
  | { kind: "standalone"; sql: string };

export type ReplayFilePlan =
  | {
      mode: "sequential";
      reason: "no-transaction" | "authored-transaction";
      statements: string[];
    }
  | {
      mode: "wrapped";
      batches: ReplayBatch[];
    };

/**
 * CLI-accurate per-file execution plan: `RESET ALL` is the caller's job.
 * Default is one `BEGIN`/`COMMIT` around the file; pipeline-incompatible
 * statements flush the batch and run standalone; a first-line pg-delta
 * directive or authored txn control skips the wrapper.
 */
export const planFileExecution = (
  sql: string,
  statements: readonly string[],
): ReplayFilePlan => {
  if (parseTransactionMode(sql) === "none") {
    return {
      mode: "sequential",
      reason: "no-transaction",
      statements: [...statements],
    };
  }
  if (statements.some(hasTransactionControl)) {
    return {
      mode: "sequential",
      reason: "authored-transaction",
      statements: [...statements],
    };
  }
  const batches: ReplayBatch[] = [];
  let pending: string[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    batches.push({ kind: "txn", statements: pending });
    pending = [];
  };
  for (const stmt of statements) {
    if (isPipelineIncompatible(stmt)) {
      flush();
      batches.push({ kind: "standalone", sql: stmt });
    } else {
      pending.push(stmt);
    }
  }
  flush();
  return { mode: "wrapped", batches };
};
