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

const pad = (n: number): string => n.toString().padStart(4, "0");

const ensureTerm = (sql: string): string =>
  sql.trimEnd().endsWith(";") ? sql.trim() : `${sql.trim()};`;

const provenanceLines = (files: string[]): string =>
  [...new Set(files)].map((file) => `-- pg-squash: from ${file}`).join("\n");

const sourcesInOrder = (statements: SquashStatement[]): string[] => {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const stmt of statements) {
    if (!seen.has(stmt.source.file)) {
      seen.add(stmt.source.file);
      files.push(stmt.source.file);
    }
  }
  return files;
};

const emitTxn = (statements: SquashStatement[]): string => {
  const header = provenanceLines(sourcesInOrder(statements));
  const body = statements.map((s) => ensureTerm(s.text)).join("\n");
  return `${header}\nBEGIN;\n${body}\nCOMMIT;\n`;
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
): { files: { name: string; sql: string }[]; manifest: ManifestEntry[] } => {
  const files: { name: string; sql: string }[] = [];
  const manifest: ManifestEntry[] = [];

  segments.forEach((segment, i) => {
    const name = `${pad(i + 1)}_squashed.sql`;
    if (segment.type === "txn") {
      files.push({ name, sql: emitTxn(segment.statements) });
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
