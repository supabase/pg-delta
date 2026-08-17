import type { Diagnostic } from "../model/diagnostics.ts";
import type {
  ByteRange,
  SquashStatement,
  TxnKind,
} from "../model/statement.ts";
import { parseSqlContent } from "@supabase/pg-topo";
import { maskSql } from "./mask.ts";

export type TxnFloor = { start: number; end: number };

export type IngestedFile =
  | {
      kind: "statements";
      file: string;
      statements: SquashStatement[];
      floors: TxnFloor[];
    }
  | {
      kind: "opaque";
      file: string;
      sql: string;
    };

const encoder = new TextEncoder();

const GROUPING_TXN = new Set<TxnKind>(["begin", "commit", "rollback"]);
const OPAQUE_TXN = new Set<TxnKind>(["savepoint", "rollback_to", "release"]);

const COPY_FROM_STDIN = /\bcopy\b[\s\S]*?\bfrom\s+stdin\b/i;
const PSQL_META = /(?:^|\n)\s*\\[a-zA-Z?]/;
const SAVEPOINT_FAMILY =
  /\b(?:savepoint\b|rollback\s+to\b|release\s+savepoint\b)/i;

const opaqueReason = (sql: string): string | undefined => {
  const masked = maskSql(sql);
  if (COPY_FROM_STDIN.test(masked)) {
    return "COPY FROM stdin (inline data)";
  }
  if (PSQL_META.test(masked)) {
    return "psql meta-command";
  }
  if (SAVEPOINT_FAMILY.test(masked)) {
    return "SAVEPOINT / ROLLBACK TO";
  }
  return undefined;
};

const txnKindFromAst = (ast: unknown): TxnKind | undefined => {
  if (!ast || typeof ast !== "object" || !("TransactionStmt" in ast)) {
    return undefined;
  }
  const kind = (ast as { TransactionStmt: { kind?: string } }).TransactionStmt
    .kind;
  switch (kind) {
    case "TRANS_STMT_BEGIN":
    case "TRANS_STMT_START":
      return "begin";
    case "TRANS_STMT_COMMIT":
      return "commit";
    case "TRANS_STMT_ROLLBACK":
      return "rollback";
    case "TRANS_STMT_SAVEPOINT":
      return "savepoint";
    case "TRANS_STMT_ROLLBACK_TO":
      return "rollback_to";
    case "TRANS_STMT_RELEASE":
      return "release";
    default:
      return undefined;
  }
};

const startsWithAt = (
  haystack: Uint8Array,
  offset: number,
  needle: Uint8Array,
): boolean => {
  if (offset + needle.length > haystack.length) return false;
  for (let i = 0; i < needle.length; i += 1) {
    if (haystack[offset + i] !== needle[i]) return false;
  }
  return true;
};

const byteRangeFor = (
  content: string,
  charOffset: number,
  sql: string,
): ByteRange => {
  const contentBytes = encoder.encode(content);
  const start = encoder.encode(content.slice(0, charOffset)).length;
  const candidates = sql.endsWith(";") ? [sql, sql.slice(0, -1)] : [sql];
  for (const candidate of candidates) {
    const needle = encoder.encode(candidate);
    if (startsWithAt(contentBytes, start, needle)) {
      return { start, end: start + needle.length };
    }
  }
  return {
    start,
    end: Math.min(contentBytes.length, start + encoder.encode(sql).length),
  };
};

export const splitSqlFile = async (
  file: string,
  sql: string,
): Promise<{ result: IngestedFile; diagnostics: Diagnostic[] }> => {
  const reason = opaqueReason(sql);
  if (reason !== undefined) {
    return {
      result: { kind: "opaque", file, sql },
      diagnostics: [
        {
          code: "opaque-file",
          message: `${file} carried as an opaque unit: ${reason}.`,
        },
      ],
    };
  }

  const parsed = await parseSqlContent(sql, file);
  if (parsed.statements.length === 0 && parsed.diagnostics.length > 0) {
    return {
      result: { kind: "opaque", file, sql },
      diagnostics: parsed.diagnostics.map((d) => ({
        code: "parse-error" as const,
        message: d.message,
      })),
    };
  }

  const statements: SquashStatement[] = [];
  const floors: TxnFloor[] = [];
  const diagnostics: Diagnostic[] = parsed.diagnostics.map((d) => ({
    code: "parse-error" as const,
    message: d.message,
  }));
  let floorStart: number | null = null;

  for (const stmt of parsed.statements) {
    const txn = txnKindFromAst(stmt.ast);
    if (txn !== undefined && OPAQUE_TXN.has(txn)) {
      return {
        result: { kind: "opaque", file, sql },
        diagnostics: [
          {
            code: "opaque-file",
            message: `${file} carried as an opaque unit: SAVEPOINT / ROLLBACK TO.`,
          },
        ],
      };
    }
    if (txn !== undefined && GROUPING_TXN.has(txn)) {
      if (txn === "begin") {
        if (floorStart === null) floorStart = statements.length;
        continue;
      }
      if (floorStart !== null) {
        floors.push({ start: floorStart, end: statements.length });
        floorStart = null;
      }
      continue;
    }

    const charOffset = stmt.id.sourceOffset ?? 0;
    statements.push({
      text: stmt.sql,
      source: {
        file,
        statementIndex: stmt.id.statementIndex,
        bytes: byteRangeFor(sql, charOffset, stmt.sql),
      },
    });
  }

  if (floorStart !== null) {
    floors.push({ start: floorStart, end: statements.length });
  }

  return {
    result: { kind: "statements", file, statements, floors },
    diagnostics,
  };
};

export const ingestChain = async (
  chain: { name: string; sql: string }[],
): Promise<{ files: IngestedFile[]; diagnostics: Diagnostic[] }> => {
  const files: IngestedFile[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const item of chain) {
    const { result, diagnostics: fileDiag } = await splitSqlFile(
      item.name,
      item.sql,
    );
    files.push(result);
    diagnostics.push(...fileDiag);
  }
  return { files, diagnostics };
};
