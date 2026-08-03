import {
  deparseSql,
  loadModule as loadPlpgsqlParserModule,
  parseSql,
} from "plpgsql-parser";
import { parseAnnotations } from "../annotations/parse-annotations.ts";
import type {
  AnnotationHints,
  Diagnostic,
  StatementId,
} from "../model/types.ts";

type RawParserStatement = {
  stmt?: unknown;
  stmt_location?: number;
  stmt_len?: number;
};

type RawParserResult = {
  stmts?: RawParserStatement[];
};

export type ParsedStatement = {
  id: StatementId;
  ast: unknown;
  sql: string;
  annotations: AnnotationHints;
};

type ParseContentResult = {
  statements: ParsedStatement[];
  diagnostics: Diagnostic[];
};

let parserModuleLoadPromise: Promise<void> | null = null;

const ensureParserModuleLoaded = async (): Promise<void> => {
  if (!parserModuleLoadPromise) {
    parserModuleLoadPromise = loadPlpgsqlParserModule();
  }
  await parserModuleLoadPromise;
};

const ensureStatementTerminator = (sql: string): string =>
  sql.trimEnd().endsWith(";") ? sql.trim() : `${sql.trim()};`;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Re-parse `candidate` and report whether it is executable on its own. */
const reparses = (candidate: string): boolean => {
  try {
    const parsed = parseSql(candidate) as RawParserResult;
    return (parsed.stmts ?? []).length > 0;
  } catch {
    return false;
  }
};

/** Convert a byte offset into `contentBytes` to a UTF-16 character offset.
 *  Statement locations always fall on character boundaries, so decoding the
 *  byte prefix is exact. */
const byteToCharOffset = (
  contentBytes: Uint8Array,
  byteOffset: number,
): number =>
  textDecoder.decode(
    contentBytes.subarray(0, Math.min(byteOffset, contentBytes.length)),
  ).length;

/** Recover a statement's SQL text, preferring the verbatim source slice.
 *  `stmt_location`/`stmt_len` are UTF-8 BYTE offsets (libpg_query), so the
 *  slice must be taken from the encoded content, never from the JS string —
 *  UTF-16 indices drift on any non-ASCII content (supabase/pg-toolbelt#369).
 *  Returns `null` when no executable text can be recovered: the deparse
 *  fallback is not trusted blindly because plpgsql-parser deparses some
 *  statements into invalid SQL (e.g. `COMMENT ON TRIGGER public.t.tr`). */
const extractStatementSql = async (
  contentBytes: Uint8Array,
  statement: RawParserStatement,
): Promise<string | null> => {
  const location = statement.stmt_location ?? 0;
  const length = statement.stmt_len ?? 0;
  if (
    Number.isInteger(location) &&
    Number.isInteger(length) &&
    location >= 0 &&
    length > 0 &&
    location + length <= contentBytes.length
  ) {
    const sliced = textDecoder
      .decode(contentBytes.subarray(location, location + length))
      .trim();
    if (sliced.length > 0) {
      const candidate = ensureStatementTerminator(sliced);
      if (reparses(candidate)) {
        return candidate;
      }
      // Fallback to deparse below when the stmt_location slice is not
      // executable on its own.
    }
  }

  if (statement.stmt) {
    try {
      const deparsed = ensureStatementTerminator(
        await deparseSql(statement.stmt as object),
      );
      if (reparses(deparsed)) {
        return deparsed;
      }
    } catch {
      // fall through to the unrecoverable result
    }
  }

  return null;
};

export const parseSqlContent = async (
  content: string,
  sourceLabel: string,
): Promise<ParseContentResult> => {
  const diagnostics: Diagnostic[] = [];
  await ensureParserModuleLoaded();

  let parseResult: RawParserResult;
  try {
    parseResult = parseSql(content) as RawParserResult;
  } catch (error) {
    diagnostics.push({
      code: "PARSE_ERROR",
      message: error instanceof Error ? error.message : "Unknown parser error.",
      statementId: {
        filePath: sourceLabel,
        statementIndex: 0,
      },
    });
    return { statements: [], diagnostics };
  }

  const statements: ParsedStatement[] = [];
  const parserStatements = parseResult.stmts ?? [];
  const contentBytes = textEncoder.encode(content);

  for (let index = 0; index < parserStatements.length; index += 1) {
    const statement = parserStatements[index];
    if (!statement?.stmt) {
      diagnostics.push({
        code: "PARSE_ERROR",
        message: "Parser returned an empty statement node.",
        statementId: {
          filePath: sourceLabel,
          statementIndex: index,
        },
      });
      continue;
    }

    const sql = await extractStatementSql(contentBytes, statement);
    if (sql === null) {
      diagnostics.push({
        code: "PARSE_ERROR",
        message:
          "Statement text could not be recovered: neither the source slice " +
          "nor its deparsed fallback re-parses as executable SQL.",
        statementId: {
          filePath: sourceLabel,
          statementIndex: index,
        },
      });
      continue;
    }
    const annotationResult = parseAnnotations(sql);

    // Advance past leading whitespace so sourceOffset points to the first character
    // of the statement (e.g. "CREATE"); statement IDs and diagnostics then refer to
    // the real start of the statement for display and editor jump-to.
    // stmt_location is a byte offset; convert to a character offset first.
    let sourceOffset = byteToCharOffset(
      contentBytes,
      statement.stmt_location ?? 0,
    );
    while (
      sourceOffset < content.length &&
      /\s/.test(content[sourceOffset] ?? "")
    ) {
      sourceOffset += 1;
    }
    statements.push({
      id: {
        filePath: sourceLabel,
        statementIndex: index,
        sourceOffset,
      },
      ast: statement.stmt,
      sql,
      annotations: annotationResult.annotations,
    });

    for (const diagnostic of annotationResult.diagnostics) {
      diagnostics.push({
        ...diagnostic,
        statementId: {
          filePath: sourceLabel,
          statementIndex: index,
          sourceOffset,
        },
      });
    }
  }

  return { statements, diagnostics };
};
