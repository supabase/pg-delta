import type {
  Segment,
  SourceRef,
  SquashStatement,
} from "../model/statement.ts";

export type ManifestEntry = {
  outputFile: string;
  statementIndex: number;
  source: SourceRef;
};

export type EmitOptions = {
  /**
   * Wrap packed txn segments in BEGIN/COMMIT. Off by default: the apply
   * runner already wraps each output file. Opt in when the SQL must be
   * self-contained (psql without a per-file wrapper).
   */
  wrapTransactions?: boolean;
};

const pad = (n: number): string => n.toString().padStart(4, "0");

const ensureTerm = (sql: string): string =>
  sql.trimEnd().endsWith(";") ? sql.trim() : `${sql.trim()};`;

const authoredTxn = (statements: readonly SquashStatement[]): boolean =>
  statements.some(
    (stmt) =>
      stmt.txn === "begin" || stmt.txn === "commit" || stmt.txn === "rollback",
  );

const emitStatements = (statements: readonly SquashStatement[]): string => {
  const lines: string[] = [];
  let prevFile: string | undefined;
  for (const stmt of statements) {
    if (prevFile !== stmt.source.file) {
      lines.push(`-- pg-squash: from ${stmt.source.file}`);
      prevFile = stmt.source.file;
    }
    lines.push(ensureTerm(stmt.text));
  }
  return `${lines.join("\n")}\n`;
};

const emitTxn = (
  statements: SquashStatement[],
  wrapTransactions: boolean,
): string => {
  const body = emitStatements(statements).trimEnd();
  if (wrapTransactions && !authoredTxn(statements)) {
    return `BEGIN;\n${body}\nCOMMIT;\n`;
  }
  return `${body}\n`;
};

const emitBarrier = (stmt: SquashStatement): string => {
  const header = [
    "-- pg-delta: transaction=false",
    "-- pg-squash: no-transaction",
    `-- pg-squash: from ${stmt.source.file}`,
  ].join("\n");
  return `${header}\n${ensureTerm(stmt.text)}\n`;
};

const emitOpaque = (file: string, sql: string): string => {
  const body = sql.endsWith("\n") ? sql : `${sql}\n`;
  return `-- pg-squash: from ${file}\n${body}`;
};

export const emit = (
  segments: Segment[],
  options: EmitOptions = {},
): { files: { name: string; sql: string }[]; manifest: ManifestEntry[] } => {
  const files: { name: string; sql: string }[] = [];
  const manifest: ManifestEntry[] = [];
  const wrap = options.wrapTransactions === true;

  segments.forEach((segment, i) => {
    const name = `${pad(i + 1)}_squashed.sql`;
    if (segment.type === "txn") {
      files.push({ name, sql: emitTxn(segment.statements, wrap) });
      segment.statements.forEach((stmt, statementIndex) => {
        manifest.push({
          outputFile: name,
          statementIndex,
          source: stmt.source,
        });
      });
      return;
    }
    if (segment.type === "barrier") {
      files.push({ name, sql: emitBarrier(segment.statement) });
      manifest.push({
        outputFile: name,
        statementIndex: 0,
        source: segment.statement.source,
      });
      return;
    }
    files.push({ name, sql: emitOpaque(segment.file, segment.sql) });
  });

  return { files, manifest };
};
