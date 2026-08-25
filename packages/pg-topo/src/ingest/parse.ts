import {
  deparseSql,
  loadModule as loadPlpgsqlParserModule,
  parseSql,
} from "plpgsql-parser";
import {
  isPgTopoAnnotationLine,
  parseAnnotations,
} from "../annotations/parse-annotations.ts";
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

const skipNestedBlockComment = (text: string, start: number): number => {
  let index = start + 2;
  let depth = 1;
  while (index < text.length && depth > 0) {
    if (text[index] === "/" && text[index + 1] === "*") {
      depth += 1;
      index += 2;
      continue;
    }
    if (text[index] === "*" && text[index + 1] === "/") {
      depth -= 1;
      index += 2;
      continue;
    }
    index += 1;
  }
  return index;
};

const skipLineComment = (text: string, start: number): number => {
  let index = start + 2;
  while (index < text.length && text[index] !== "\n") {
    index += 1;
  }
  return index;
};

/** File-level comments sit inside stmt 0's byte slice (`stmt_location` is
 *  omitted or 0). Collect `-- pg-topo:` lines; skip other leading trivia so
 *  sourceOffset / executable SQL start at the keyword. */
const scanLeadingTrivia = (
  text: string,
  start: number,
): { annotationLines: string[]; executableOffset: number } => {
  let index = start;
  const annotationLines: string[] = [];

  while (index < text.length) {
    const char = text[index];
    if (char !== undefined && /\s/u.test(char)) {
      index += 1;
      continue;
    }

    if (char === "-" && text[index + 1] === "-") {
      const lineEnd = skipLineComment(text, index);
      const line = text.slice(index, lineEnd);
      if (isPgTopoAnnotationLine(line)) {
        annotationLines.push(line.replace(/\r$/u, ""));
      }
      index = lineEnd;
      continue;
    }

    if (char === "/" && text[index + 1] === "*") {
      index = skipNestedBlockComment(text, index);
      continue;
    }

    return { annotationLines, executableOffset: index };
  }

  return { annotationLines, executableOffset: index };
};

const stripNonAnnotationLeadingTrivia = (sql: string): string => {
  const { annotationLines, executableOffset } = scanLeadingTrivia(sql, 0);
  const executable = sql.slice(executableOffset);
  if (annotationLines.length === 0) {
    return executable;
  }
  return `${annotationLines.join("\n")}\n${executable}`;
};

/** Re-parse `candidate` and report whether it is executable on its own. */
const reparses = (candidate: string): boolean => {
  try {
    const parsed = parseSql(candidate) as RawParserResult;
    return (parsed.stmts ?? []).length > 0;
  } catch {
    return false;
  }
};

/** Convert byte offsets into `contentBytes` to UTF-16 character offsets.
 *  Statement locations always fall on character boundaries, so decoding byte
 *  prefixes is exact. Offsets are converted incrementally (statements arrive
 *  in source order), so the total decode work stays linear in the content
 *  size instead of quadratic in the statement count. */
const makeByteToCharOffset = (
  contentBytes: Uint8Array,
): ((byteOffset: number) => number) => {
  let prevByte = 0;
  let prevChar = 0;
  return (byteOffset: number): number => {
    const clamped = Math.min(Math.max(byteOffset, 0), contentBytes.length);
    if (clamped < prevByte) {
      prevByte = 0;
      prevChar = 0;
    }
    prevChar += textDecoder.decode(
      contentBytes.subarray(prevByte, clamped),
    ).length;
    prevByte = clamped;
    return prevChar;
  };
};

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
  isLast: boolean,
): Promise<string | null> => {
  const location = statement.stmt_location ?? 0;
  // libpg_query omits stmt_len for a final statement that has no terminating
  // semicolon; the statement then runs to the end of the content.
  const length =
    statement.stmt_len ?? (isLast ? contentBytes.length - location : 0);
  if (
    Number.isInteger(location) &&
    Number.isInteger(length) &&
    location >= 0 &&
    length > 0 &&
    location + length <= contentBytes.length
  ) {
    const sliced = stripNonAnnotationLeadingTrivia(
      textDecoder.decode(contentBytes.subarray(location, location + length)),
    );
    if (sliced.trim().length > 0) {
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
  const byteToCharOffset = makeByteToCharOffset(contentBytes);

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

    const sql = await extractStatementSql(
      contentBytes,
      statement,
      index === parserStatements.length - 1,
    );
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

    // stmt_location is a byte offset (often 0/omitted for statement 0). Convert
    // to a character offset, then skip trivia so the id points at the keyword.
    const sourceOffset = scanLeadingTrivia(
      content,
      byteToCharOffset(statement.stmt_location ?? 0),
    ).executableOffset;
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
