import { parseDefinitionItem } from "./format-utils.ts";
import { isWordChar, walkSql } from "./sql-scanner.ts";
import {
  findTopLevelParen,
  scanTokens,
  skipQualifiedName,
} from "./tokenizer.ts";
import type { NormalizedOptions, Token } from "./types.ts";

type Range = { start: number; end: number };
type ProtectedRangeResult = { ranges: Range[]; unsafe: boolean };

const OPTION_LIST_KEYWORDS = new Set(["WITH", "SET", "OPTIONS", "RESET"]);
const STRUCTURAL_TOP_LEVEL_KEYWORDS = new Set([
  "ADD",
  "ADMIN",
  "AFTER",
  "AGGREGATE",
  "ALL",
  "ALTER",
  "ALWAYS",
  "AS",
  "ATTACH",
  "ATTRIBUTE",
  "AUTHORIZATION",
  "BEFORE",
  "BY",
  "CACHE",
  "CALLED",
  "CANONICAL",
  "CASCADE",
  "CHECK",
  "COMBINEFUNC",
  "COLLATE",
  "COLLATION",
  "COLUMN",
  "COMMENT",
  "CONNECTION",
  "CONSTRAINT",
  "COST",
  "CREATE",
  "CREATEDB",
  "CURRENT_TIMESTAMP",
  "CYCLE",
  "DATA",
  "DEFAULT",
  "DEFERRABLE",
  "DEFERRED",
  "DEFINER",
  "DELETE",
  "DESERIALFUNC",
  "DETACH",
  "DETERMINISTIC",
  "DISABLE",
  "DO",
  "DOMAIN",
  "DROP",
  "EACH",
  "ENABLE",
  "END",
  "ENUM",
  "EVENT",
  "EXECUTE",
  "EXISTS",
  "EXTENSION",
  "FINALFUNC",
  "FINALFUNC_EXTRA",
  "FINALFUNC_MODIFY",
  "FOR",
  "FORCE",
  "FOREIGN",
  "FROM",
  "FULL",
  "FUNCTION",
  "GENERATED",
  "GRANT",
  "HANDLER",
  "HYPOTHETICAL",
  "IDENTITY",
  "IF",
  "IMMUTABLE",
  "IN",
  "INDEX",
  "INCREMENT",
  "INHERIT",
  "INHERITS",
  "INITIALLY",
  "INITCOND",
  "INLINE",
  "INPUT",
  "INSERT",
  "INSTEAD",
  "INVOKER",
  "IS",
  "KEY",
  "LANGUAGE",
  "LC_COLLATE",
  "LC_CTYPE",
  "LEAKPROOF",
  "LEVEL",
  "LIMIT",
  "LOCALE",
  "LOGGED",
  "LOGIN",
  "MATERIALIZED",
  "MAXVALUE",
  "MATCH",
  "MFINALFUNC",
  "MFINALFUNC_EXTRA",
  "MFINALFUNC_MODIFY",
  "MINITCOND",
  "MINVFUNC",
  "MINVALUE",
  "MSFUNC",
  "MSSPACE",
  "MSTYPE",
  "NO",
  "NOSUPERUSER",
  "NOT",
  "NOTHING",
  "NULL",
  "OF",
  "ON",
  "ONLY",
  "OPTION",
  "OPTIONS",
  "OR",
  "OWNED",
  "OWNER",
  "PERMISSIVE",
  "PARALLEL",
  "PARTITION",
  "POLICY",
  "PRIMARY",
  "PROCEDURE",
  "PROVIDER",
  "PUBLICATION",
  "PRIVILEGES",
  "RANGE",
  "REFERENCING",
  "REFRESH",
  "REFERENCES",
  "REPLACE",
  "REPLICA",
  "RESET",
  "RESTRICT",
  "RESTRICTED",
  "RESTRICTIVE",
  "RETURNS",
  "REVOKE",
  "ROLE",
  "ROW",
  "ROWS",
  "RULE",
  "RULES",
  "SAFE",
  "SCHEMA",
  "SECURITY",
  "SELECT",
  "SEQUENCE",
  "SERIALFUNC",
  "SERVER",
  "SET",
  "SFUNC",
  "SORTOP",
  "SSPACE",
  "STYPE",
  "SUBTYPE",
  "SUBTYPE_DIFF",
  "SUBTYPE_OPCLASS",
  "STABLE",
  "STATISTICS",
  "STORED",
  "STRICT",
  "SUBSCRIPTION",
  "SUPPORT",
  "TABLE",
  "TABLES",
  "TABLESPACE",
  "TAG",
  "TEMP",
  "TEMPORARY",
  "TO",
  "TRIGGER",
  "TRUSTED",
  "TYPE",
  "UNIQUE",
  "UNLOGGED",
  "UNSAFE",
  "UPDATE",
  "USER",
  "USAGE",
  "USING",
  "VALIDATE",
  "VALID",
  "VALIDATOR",
  "VALUE",
  "VALUES",
  "VERSION",
  "VIEW",
  "VOLATILE",
  "WHEN",
  "WHERE",
  "WINDOW",
  "WITH",
  "WITHOUT",
  "WRAPPER",
  "MAPPING",
]);
const EMPTY_SCOPED_SET: ReadonlySet<string> = new Set();

const ALTER_DEFAULT_PRIVILEGES_KEYWORDS: ReadonlySet<string> = new Set([
  "PUBLIC",
  "SEQUENCES",
  "ROUTINES",
  "TYPES",
  "SCHEMAS",
]);

const GRANT_REVOKE_KEYWORDS: ReadonlySet<string> = new Set(["PUBLIC"]);

function getStatementScopedKeywords(
  topLevelTokens: Array<{ token: Token; index: number }>,
): ReadonlySet<string> {
  const first = topLevelTokens[0]?.token.upper;
  const second = topLevelTokens[1]?.token.upper;
  const third = topLevelTokens[2]?.token.upper;

  if (first === "ALTER" && second === "DEFAULT" && third === "PRIVILEGES") {
    return ALTER_DEFAULT_PRIVILEGES_KEYWORDS;
  }

  if (first === "GRANT" || first === "REVOKE") {
    return GRANT_REVOKE_KEYWORDS;
  }

  return EMPTY_SCOPED_SET;
}

const ALTER_TYPE_BOUNDARY_KEYWORDS = new Set([
  "COLLATE",
  "USING",
  "SET",
  "RESET",
  "DROP",
]);

export function applyKeywordCase(
  statement: string,
  options: NormalizedOptions,
): string {
  const tokens = scanTokens(statement);
  const transform =
    options.keywordCase === "upper"
      ? (value: string) => value.toUpperCase()
      : (value: string) => value.toLowerCase();
  const protectedResult = collectProtectedRanges(statement, tokens);
  if (protectedResult.unsafe) {
    return statement;
  }
  const protectedRanges = protectedResult.ranges;
  const caseableTokenStarts = collectCaseableTokenStarts(statement, tokens);

  let output = "";
  let skipUntil = -1;
  let rangeIndex = 0;

  walkSql(
    statement,
    (index, char) => {
      if (index < skipUntil) return true;
      while (
        rangeIndex < protectedRanges.length &&
        protectedRanges[rangeIndex]!.end <= index
      ) {
        rangeIndex += 1;
      }
      if (isWordChar(char)) {
        let end = index + 1;
        while (end < statement.length && isWordChar(statement[end]!)) {
          end += 1;
        }
        const word = statement.slice(index, end);
        const range = protectedRanges[rangeIndex];
        const isProtected =
          range !== undefined && range.start < end && index < range.end;
        const shouldCase = !isProtected && caseableTokenStarts.has(index);
        output += shouldCase ? transform(word) : word;
        skipUntil = end;
        return true;
      }
      output += char;
      return true;
    },
    {
      onSkipped: (chunk) => {
        output += chunk;
      },
    },
  );

  return output;
}

function collectCaseableTokenStarts(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
): Set<number> {
  const caseable = new Set<number>();

  const topLevelTokens: Array<{ token: Token; index: number }> = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]!.depth === 0) {
      topLevelTokens.push({ token: tokens[i]!, index: i });
    }
  }
  if (topLevelTokens.length === 0) return caseable;

  const command = topLevelTokens[0]!.token.upper;
  const scopedKeywords = getStatementScopedKeywords(topLevelTokens);
  const objectNameTokenIndexes = new Set<number>();
  for (let topIndex = 0; topIndex < topLevelTokens.length; topIndex += 1) {
    if (isLikelyObjectNameToken(command, topLevelTokens, topIndex)) {
      objectNameTokenIndexes.add(topLevelTokens[topIndex]!.index);
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const upper = token.upper;
    if (!STRUCTURAL_TOP_LEVEL_KEYWORDS.has(upper) && !scopedKeywords.has(upper))
      continue;
    if (objectNameTokenIndexes.has(index)) continue;
    if (isQualifiedIdentifierToken(statement, token)) continue;

    const prev = tokens[index - 1]?.upper;
    if (!isCaseableInContext(command, upper, prev)) continue;

    caseable.add(token.start);
  }

  return caseable;
}

function isLikelyObjectNameToken(
  command: string,
  topLevelTokens: Array<{ token: Token; index: number }>,
  topIndex: number,
): boolean {
  if (command === "CREATE") {
    let cursor = 1;
    if (
      topLevelTokens[cursor]?.token.upper === "OR" &&
      topLevelTokens[cursor + 1]?.token.upper === "REPLACE"
    ) {
      cursor += 2;
    }
    while (
      topLevelTokens[cursor]?.token.upper === "TEMP" ||
      topLevelTokens[cursor]?.token.upper === "TEMPORARY" ||
      topLevelTokens[cursor]?.token.upper === "UNLOGGED" ||
      topLevelTokens[cursor]?.token.upper === "UNIQUE" ||
      topLevelTokens[cursor]?.token.upper === "TRUSTED"
    ) {
      cursor += 1;
    }
    const shape = readObjectShape(topLevelTokens, cursor);
    if (!shape.hasDirectName) {
      return false;
    }

    let nameIndex = shape.objectEnd + 1;
    if (
      topLevelTokens[nameIndex]?.token.upper === "IF" &&
      topLevelTokens[nameIndex + 1]?.token.upper === "NOT" &&
      topLevelTokens[nameIndex + 2]?.token.upper === "EXISTS"
    ) {
      nameIndex += 3;
    }

    return topIndex === nameIndex;
  }

  if (command === "DROP") {
    const shape = readObjectShape(topLevelTokens, 1);
    if (!shape.hasDirectName) {
      return false;
    }
    let nameIndex = shape.objectEnd + 1;
    if (
      topLevelTokens[nameIndex]?.token.upper === "IF" &&
      topLevelTokens[nameIndex + 1]?.token.upper === "EXISTS"
    ) {
      nameIndex += 2;
    }
    return topIndex === nameIndex;
  }

  if (command === "ALTER") {
    const shape = readObjectShape(topLevelTokens, 1);
    if (!shape.hasDirectName) {
      return false;
    }
    let nameIndex = shape.objectEnd + 1;

    if (
      topLevelTokens[nameIndex]?.token.upper === "IF" &&
      topLevelTokens[nameIndex + 1]?.token.upper === "EXISTS"
    ) {
      nameIndex += 2;
    }
    if (topLevelTokens[nameIndex]?.token.upper === "ONLY") {
      nameIndex += 1;
    }
    return topIndex === nameIndex;
  }

  if (command === "COMMENT") {
    const onIndex = findTopLevelIndex(topLevelTokens, "ON");
    if (onIndex < 0) return false;
    const shape = readObjectShape(topLevelTokens, onIndex + 1);
    if (!shape.hasDirectName) {
      return false;
    }
    return topIndex === shape.objectEnd + 1;
  }

  return false;
}

function isCaseableInContext(
  command: string,
  upper: string,
  prev: string | undefined,
): boolean {
  if (command === "COMMENT") {
    return (
      upper === "COMMENT" ||
      upper === "ON" ||
      upper === "IS" ||
      upper === "NULL" ||
      prev === "ON" ||
      (prev === "MATERIALIZED" && upper === "VIEW") ||
      (prev === "FOREIGN" && (upper === "TABLE" || upper === "DATA")) ||
      (prev === "DATA" && upper === "WRAPPER") ||
      (prev === "EVENT" && upper === "TRIGGER")
    );
  }

  if (upper === "SAFE" || upper === "UNSAFE" || upper === "RESTRICTED") {
    return prev === "PARALLEL";
  }
  if (upper === "RESTRICTIVE" || upper === "PERMISSIVE") {
    return prev === "AS";
  }
  if (upper === "DEFINER" || upper === "INVOKER") {
    return prev === "SECURITY";
  }
  if (upper === "ADMIN") {
    return prev === "WITH" || prev === "REVOKE";
  }
  if (upper === "LEVEL") {
    return prev === "ROW";
  }
  if (upper === "KEY") {
    return prev === "PRIMARY" || prev === "FOREIGN";
  }
  if (upper === "IDENTITY") {
    return prev === "REPLICA" || prev === "AS";
  }
  if (upper === "PUBLIC") {
    return prev === "TO" || prev === "FROM";
  }
  if (upper === "OR") {
    return true;
  }
  if (upper === "REPLACE") {
    return prev === "OR";
  }
  if (upper === "AS" && command === "CREATE") {
    return true;
  }

  return true;
}

function isQualifiedIdentifierToken(statement: string, token: Token): boolean {
  if (token.upper === "NEW" || token.upper === "OLD") {
    return false;
  }
  const before = statement[token.start - 1];
  const after = statement[token.end];
  return before === "." || after === ".";
}

function findTopLevelIndex(
  topLevelTokens: Array<{ token: Token; index: number }>,
  keyword: string,
): number {
  for (let i = 0; i < topLevelTokens.length; i += 1) {
    if (topLevelTokens[i]!.token.upper === keyword) return i;
  }
  return -1;
}

function readObjectShape(
  topLevelTokens: Array<{ token: Token; index: number }>,
  start: number,
): { objectEnd: number; hasDirectName: boolean } {
  const first = topLevelTokens[start]?.token.upper;
  const second = topLevelTokens[start + 1]?.token.upper;
  const third = topLevelTokens[start + 2]?.token.upper;

  if (!first) {
    return { objectEnd: start, hasDirectName: false };
  }
  if (first === "FOREIGN" && second === "DATA" && third === "WRAPPER") {
    return { objectEnd: start + 2, hasDirectName: true };
  }
  if (first === "FOREIGN" && second === "TABLE") {
    return { objectEnd: start + 1, hasDirectName: true };
  }
  if (first === "MATERIALIZED" && second === "VIEW") {
    return { objectEnd: start + 1, hasDirectName: true };
  }
  if (first === "EVENT" && second === "TRIGGER") {
    return { objectEnd: start + 1, hasDirectName: true };
  }
  if (first === "USER" && second === "MAPPING") {
    return { objectEnd: start + 1, hasDirectName: false };
  }
  if (first === "DEFAULT" && second === "PRIVILEGES") {
    return { objectEnd: start + 1, hasDirectName: false };
  }

  return { objectEnd: start, hasDirectName: true };
}

function collectProtectedRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
): ProtectedRangeResult {
  if (tokens.length === 0) return { ranges: [], unsafe: false };
  const ranges: Range[] = [];
  let unsafe = false;

  unsafe = collectCheckClauseRanges(statement, tokens, ranges) || unsafe;
  unsafe = collectOptionAssignmentRanges(statement, tokens, ranges) || unsafe;
  collectDefinitionRanges(statement, tokens, ranges);

  return { ranges: mergeRanges(ranges), unsafe };
}

function collectCheckClauseRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): boolean {
  let unsafe = false;
  const isTrigger =
    tokens[0]?.upper === "CREATE" &&
    tokens.some((t) => t.depth === 0 && t.upper === "TRIGGER");

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;

    if (token.upper === "CHECK") {
      const open = findImmediateParen(statement, token.end);
      if (open < 0) continue;

      const close = findMatchingParen(statement, open);
      if (close < 0) {
        unsafe = true;
        continue;
      }

      ranges.push({ start: open, end: close + 1 });
      continue;
    }

    if (token.upper === "WHEN" && token.depth === 0 && isTrigger) {
      const open = findImmediateParen(statement, token.end);
      if (open < 0) continue;

      const close = findMatchingParen(statement, open);
      if (close < 0) {
        unsafe = true;
        continue;
      }

      ranges.push({ start: open, end: close + 1 });
    }
  }

  return unsafe;
}

function collectOptionAssignmentRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): boolean {
  let unsafe = false;
  for (const token of tokens) {
    if (token.depth !== 0 || !OPTION_LIST_KEYWORDS.has(token.upper)) continue;
    const open = findImmediateParen(statement, token.end);
    if (open < 0) continue;
    const close = findMatchingParen(statement, open);
    if (close < 0) {
      unsafe = true;
      continue;
    }
    if (token.upper === "OPTIONS") {
      collectAllOptionItemRanges(statement, open, close, ranges);
    } else {
      collectAssignmentItemRanges(statement, open, close, ranges);
    }
  }

  unsafe =
    collectCreateOptionBlockAssignmentRanges(statement, tokens, ranges) ||
    unsafe;

  return unsafe;
}

function collectCreateOptionBlockAssignmentRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): boolean {
  let unsafe = false;
  if (tokens[0]?.upper !== "CREATE") return false;

  if (tokens[1]?.upper === "COLLATION") {
    const parens = findTopLevelParen(statement, tokens[1].end);
    if (parens) {
      collectAssignmentItemRanges(statement, parens.open, parens.close, ranges);
    }
    return unsafe;
  }

  if (tokens[1]?.upper === "TYPE") {
    for (let i = 2; i < tokens.length; i += 1) {
      if (tokens[i]!.depth !== 0 || tokens[i]!.upper !== "AS") continue;
      if (tokens[i + 1]?.depth !== 0 || tokens[i + 1]?.upper !== "RANGE") {
        continue;
      }
      const parens = findTopLevelParen(statement, tokens[i + 1]!.end);
      if (parens) {
        collectAssignmentItemRanges(
          statement,
          parens.open,
          parens.close,
          ranges,
        );
      } else {
        unsafe = true;
      }
      return unsafe;
    }
    return unsafe;
  }

  if (tokens[1]?.upper === "AGGREGATE") {
    const argParens = findTopLevelParen(statement, tokens[1].end);
    if (!argParens) return true;
    const optParens = findTopLevelParen(statement, argParens.close + 1);
    if (!optParens) return true;
    collectAssignmentItemRanges(
      statement,
      optParens.open,
      optParens.close,
      ranges,
    );
  }

  return unsafe;
}

function collectAssignmentItemRanges(
  statement: string,
  open: number,
  close: number,
  ranges: Range[],
): void {
  const content = statement.slice(open + 1, close);
  const items = splitTopLevelCommaItems(content, open + 1);
  for (const item of items) {
    const equalsIndex = findTopLevelEquals(item.text);
    if (equalsIndex < 0) continue;

    const key = item.text.slice(0, equalsIndex).trim();
    const value = item.text.slice(equalsIndex + 1).trim();
    if (key.length === 0 || value.length === 0) continue;

    // Only protect the value side so keys can be cased
    const valueStart = item.start + equalsIndex + 1;
    ranges.push({ start: valueStart, end: item.end });
  }
}

function collectAllOptionItemRanges(
  statement: string,
  open: number,
  close: number,
  ranges: Range[],
): void {
  const content = statement.slice(open + 1, close);
  const items = splitTopLevelCommaItems(content, open + 1);
  for (const item of items) {
    if (item.text.trim().length === 0) continue;
    ranges.push({ start: item.start, end: item.end });
  }
}

function collectDefinitionRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): void {
  collectCreateDefinitionRanges(statement, tokens, ranges);
  collectAlterDefinitionRanges(statement, tokens, ranges);
}

function collectCreateDefinitionRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): void {
  if (tokens[0]?.upper !== "CREATE") return;

  const tableToken = tokens.find((token, index) => {
    if (token.depth !== 0 || token.upper !== "TABLE") return false;
    return tokens[index - 1]?.upper !== "RETURNS";
  });
  if (tableToken) {
    const parens = findTopLevelParen(statement, tableToken.end);
    if (parens) {
      const hasPartitionBeforeColumns = tokens.some(
        (token) =>
          token.depth === 0 &&
          token.upper === "PARTITION" &&
          token.start < parens.open,
      );
      if (!hasPartitionBeforeColumns) {
        collectDefinitionRangesFromParen(
          statement,
          parens.open,
          parens.close,
          ranges,
        );
      }
    }
  }

  if (tokens[1]?.upper === "TYPE") {
    const asIndex = tokens.findIndex(
      (token, index) =>
        token.depth === 0 &&
        token.upper === "AS" &&
        tokens[index + 1]?.depth === 0 &&
        tokens[index + 1]?.upper !== "ENUM" &&
        tokens[index + 1]?.upper !== "RANGE",
    );
    if (asIndex !== -1) {
      const parens = findTopLevelParen(statement, tokens[asIndex]!.end);
      if (parens) {
        collectDefinitionRangesFromParen(
          statement,
          parens.open,
          parens.close,
          ranges,
        );
      }
    }
  }

  let objectIndex = 1;
  if (tokens[1]?.upper === "OR" && tokens[2]?.upper === "REPLACE") {
    objectIndex = 3;
  }
  const objectToken = tokens[objectIndex];
  if (objectToken?.upper === "FUNCTION" || objectToken?.upper === "PROCEDURE") {
    const argParens = findTopLevelParen(statement, objectToken.end);
    if (argParens) {
      collectDefinitionRangesFromParen(
        statement,
        argParens.open,
        argParens.close,
        ranges,
      );
    }
  }

  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (
      tokens[i]!.depth === 0 &&
      tokens[i]!.upper === "RETURNS" &&
      tokens[i + 1]!.depth === 0 &&
      tokens[i + 1]!.upper === "TABLE"
    ) {
      const parens = findTopLevelParen(statement, tokens[i + 1]!.end);
      if (parens) {
        collectDefinitionRangesFromParen(
          statement,
          parens.open,
          parens.close,
          ranges,
        );
      }
    }
  }
}

function collectAlterDefinitionRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): void {
  if (tokens[0]?.upper !== "ALTER") return;

  let cursor = 1;
  if (tokens[cursor]?.upper === "TABLE") {
    cursor += 1;
  } else if (
    tokens[cursor]?.upper === "FOREIGN" &&
    tokens[cursor + 1]?.upper === "TABLE"
  ) {
    cursor += 2;
  } else {
    return;
  }

  if (
    tokens[cursor]?.upper === "IF" &&
    tokens[cursor + 1]?.upper === "EXISTS"
  ) {
    cursor += 2;
  }
  if (tokens[cursor]?.upper === "ONLY") {
    cursor += 1;
  }
  if (cursor >= tokens.length) return;

  cursor = skipQualifiedName(statement, tokens, cursor);
  if (cursor >= tokens.length) return;

  for (let i = cursor; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.depth !== 0) continue;

    const actionEnd = findNextTopLevelComma(statement, token.start);
    const end = actionEnd < 0 ? statement.length : actionEnd;

    if (token.upper === "ADD") {
      let defIndex = i + 1;
      if (
        tokens[defIndex]?.depth === 0 &&
        tokens[defIndex]!.upper === "COLUMN"
      ) {
        defIndex += 1;
      }
      if (
        tokens[defIndex]?.depth === 0 &&
        tokens[defIndex]!.upper === "IF" &&
        tokens[defIndex + 1]?.depth === 0 &&
        tokens[defIndex + 1]!.upper === "NOT" &&
        tokens[defIndex + 2]?.depth === 0 &&
        tokens[defIndex + 2]!.upper === "EXISTS"
      ) {
        defIndex += 3;
      }
      const defToken = tokens[defIndex];
      if (!defToken || defToken.start >= end) continue;
      const segment = statement.slice(defToken.start, end);
      const parsed = parseDefinitionItem(segment);
      if (!parsed) continue;
      ranges.push({
        start: defToken.start + parsed.bounds.nameStart,
        end: defToken.start + parsed.bounds.typeEnd,
      });
      continue;
    }

    if (
      token.upper === "ALTER" &&
      tokens[i + 1]?.depth === 0 &&
      tokens[i + 1]!.upper === "COLUMN"
    ) {
      const nameToken = tokens[i + 2];
      if (!nameToken || nameToken.depth !== 0 || nameToken.start >= end) {
        continue;
      }

      let typeTokenIndex = -1;
      for (let j = i + 3; j < tokens.length; j += 1) {
        const candidate = tokens[j]!;
        if (candidate.start >= end) break;
        if (candidate.depth !== 0) continue;
        if (candidate.upper === "TYPE") {
          typeTokenIndex = j;
          break;
        }
        if (
          candidate.upper === "SET" ||
          candidate.upper === "RESET" ||
          candidate.upper === "DROP"
        ) {
          break;
        }
      }
      if (typeTokenIndex < 0) continue;

      ranges.push({ start: nameToken.start, end: nameToken.end });

      const typeToken = tokens[typeTokenIndex]!;
      let typeStart = typeToken.end;
      while (typeStart < end && /\s/.test(statement[typeStart]!)) {
        typeStart += 1;
      }
      let typeEnd = end;
      for (let j = typeTokenIndex + 1; j < tokens.length; j += 1) {
        const candidate = tokens[j]!;
        if (candidate.start >= end) break;
        if (candidate.depth !== 0) continue;
        if (ALTER_TYPE_BOUNDARY_KEYWORDS.has(candidate.upper)) {
          typeEnd = candidate.start;
          break;
        }
      }
      while (typeEnd > typeStart && /\s/.test(statement[typeEnd - 1]!)) {
        typeEnd -= 1;
      }
      if (typeStart < typeEnd) {
        ranges.push({ start: typeStart, end: typeEnd });
      }
    }
  }
}

function collectDefinitionRangesFromParen(
  statement: string,
  open: number,
  close: number,
  ranges: Range[],
): void {
  const content = statement.slice(open + 1, close);
  const items = splitTopLevelCommaItems(content, open + 1);
  for (const item of items) {
    const parsed = parseDefinitionItem(item.text);
    if (!parsed) continue;
    ranges.push({
      start: item.start + parsed.bounds.nameStart,
      end: item.start + parsed.bounds.typeEnd,
    });
  }
}

function splitTopLevelCommaItems(
  content: string,
  offset: number,
): Array<{ text: string; start: number; end: number }> {
  const rawRanges: Array<{ start: number; end: number }> = [];
  let segmentStart = 0;

  walkSql(
    content,
    (index, char, depth) => {
      if (char === "(" || char === ")") return true;
      if (char === "," && depth === 0) {
        rawRanges.push({ start: segmentStart, end: index });
        segmentStart = index + 1;
      }
      return true;
    },
    { trackDepth: true },
  );
  rawRanges.push({ start: segmentStart, end: content.length });

  return rawRanges
    .map((range) => trimRange(content, range.start, range.end, offset))
    .filter(
      (item): item is { text: string; start: number; end: number } =>
        item !== null,
    );
}

function trimRange(
  content: string,
  start: number,
  end: number,
  offset: number,
): { text: string; start: number; end: number } | null {
  let trimmedStart = start;
  let trimmedEnd = end;

  while (trimmedStart < trimmedEnd && /\s/.test(content[trimmedStart]!)) {
    trimmedStart += 1;
  }
  while (trimmedEnd > trimmedStart && /\s/.test(content[trimmedEnd - 1]!)) {
    trimmedEnd -= 1;
  }
  if (trimmedStart >= trimmedEnd) return null;

  return {
    text: content.slice(trimmedStart, trimmedEnd),
    start: offset + trimmedStart,
    end: offset + trimmedEnd,
  };
}

function findTopLevelEquals(text: string): number {
  let equals = -1;

  walkSql(
    text,
    (index, char, depth) => {
      if (char === "(" || char === ")") return true;
      if (char !== "=" || depth !== 0) return true;

      const prev = previousNonSpace(text, index - 1);
      const next = nextNonSpace(text, index + 1);
      if (
        prev === "<" ||
        prev === ">" ||
        prev === "!" ||
        prev === "=" ||
        next === "="
      ) {
        return true;
      }

      equals = index;
      return false;
    },
    { trackDepth: true },
  );

  return equals;
}

function previousNonSpace(text: string, index: number): string | null {
  let i = index;
  while (i >= 0 && /\s/.test(text[i]!)) i -= 1;
  return i >= 0 ? (text[i] ?? null) : null;
}

function nextNonSpace(text: string, index: number): string | null {
  let i = index;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  return i < text.length ? (text[i] ?? null) : null;
}

function findImmediateParen(statement: string, start: number): number {
  let index = start;
  while (index < statement.length && /\s/.test(statement[index]!)) {
    index += 1;
  }
  return statement[index] === "(" ? index : -1;
}

function findMatchingParen(statement: string, open: number): number {
  let close = -1;
  let openDepth = -1;

  walkSql(
    statement,
    (index, char, depth) => {
      if (index === open) {
        if (char !== "(") return false;
        openDepth = depth;
        return true;
      }
      if (openDepth >= 0 && char === ")" && depth === openDepth) {
        close = index;
        return false;
      }
      return true;
    },
    { trackDepth: true, startIndex: open },
  );

  return close;
}

function findNextTopLevelComma(text: string, start: number): number {
  let comma = -1;

  walkSql(
    text,
    (index, char, depth) => {
      if (char === "," && depth === 0) {
        comma = index;
        return false;
      }
      return true;
    },
    { trackDepth: true, startIndex: start },
  );

  return comma;
}

function mergeRanges(ranges: Range[]): Range[] {
  const filtered = ranges
    .filter((range) => range.start < range.end)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: Range[] = [];
  for (const range of filtered) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}
