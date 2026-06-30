import { isWordChar, walkSql } from "./sql-scanner.ts";
import type { Token } from "./types.ts";

/**
 * Index just past a single SQL identifier (quoted or unquoted) at/after `from`,
 * skipping leading whitespace. `scanTokens` drops double-quoted identifiers, so
 * positional `tokens[N]` indexing lands PAST a quoted object name onto the next
 * clause keyword; a formatter that needs the name's true end (to slice the
 * header before the first clause) scans the raw statement with this instead.
 */
export function identifierEnd(statement: string, from: number): number {
  let i = from;
  while (i < statement.length && /\s/.test(statement[i]!)) i += 1;
  if (statement[i] === '"') {
    i += 1;
    while (i < statement.length) {
      if (statement[i] === '"') {
        if (statement[i + 1] === '"') {
          i += 2; // escaped "" inside a quoted identifier
          continue;
        }
        return i + 1; // closing quote
      }
      i += 1;
    }
    return i; // unterminated — caller still gets a sane bound
  }
  while (i < statement.length && isWordChar(statement[i]!)) i += 1;
  return i;
}

export function scanTokens(statement: string): Token[] {
  const tokens: Token[] = [];
  let skipUntil = -1;

  walkSql(
    statement,
    (index, char, depth) => {
      if (index < skipUntil) return true;
      if (char === "(" || char === ")") return true;
      if (isWordChar(char)) {
        let end = index + 1;
        while (end < statement.length && isWordChar(statement[end]!)) {
          end += 1;
        }
        const value = statement.slice(index, end);
        tokens.push({
          value,
          upper: value.toUpperCase(),
          start: index,
          end,
          depth,
        });
        skipUntil = end;
      }
      return true;
    },
    { trackDepth: true },
  );

  return tokens;
}

export function findTopLevelParen(
  statement: string,
  startIndex: number,
): { open: number; close: number } | null {
  let result: { open: number; close: number } | null = null;
  let openIndex: number | null = null;

  walkSql(
    statement,
    (index, char, depth) => {
      if (char === "(") {
        if (depth === 0) {
          openIndex = index;
        }
        return true;
      }
      if (char === ")") {
        if (depth === 0 && openIndex !== null) {
          result = { open: openIndex, close: index };
          return false;
        }
      }
      return true;
    },
    { trackDepth: true, startIndex },
  );

  return result;
}

/**
 * Collect the starting positions of top-level clause keywords in a token list.
 * Returns a sorted array of character offsets (Token.start values).
 */
export function findClausePositions(
  tokens: Token[],
  keywords: Set<string>,
): number[] {
  const positions: number[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok.depth !== 0) continue;
    if (keywords.has(tok.upper)) {
      positions.push(tok.start);
    }
  }
  positions.sort((a, b) => a - b);
  return positions;
}

/**
 * Advance a cursor past a possibly schema-qualified name (e.g. `public.my_table`).
 * Returns the new cursor position (pointing to the first token after the name).
 */
export function skipQualifiedName(
  statement: string,
  tokens: Token[],
  cursor: number,
): number {
  let c = cursor + 1;
  while (c < tokens.length) {
    const curr = tokens[c]!;
    const prev = tokens[c - 1]!;
    if (curr.start !== prev.end + 1 || statement[prev.end] !== ".") break;
    c += 1;
  }
  return c;
}

/**
 * Slice a text into clause strings given sorted clause-start positions.
 * Returns trimmed, non-empty clause strings.
 */
export function sliceClauses(text: string, positions: number[]): string[] {
  const clauses: string[] = [];
  for (let i = 0; i < positions.length; i += 1) {
    const start = positions[i];
    const end = positions[i + 1] ?? text.length;
    const clause = text.slice(start, end).trim();
    if (clause.length > 0) clauses.push(clause);
  }
  return clauses;
}

export function splitByCommas(content: string): string[] {
  const items: string[] = [];
  let buffer = "";

  walkSql(
    content,
    (_index, char, depth) => {
      if (char === "(" || char === ")") {
        buffer += char;
        return true;
      }
      if (char === "," && depth === 0) {
        items.push(buffer);
        buffer = "";
        return true;
      }
      buffer += char;
      return true;
    },
    {
      trackDepth: true,
      onSkipped: (chunk) => {
        buffer += chunk;
      },
    },
  );

  if (buffer.length > 0) {
    items.push(buffer);
  }

  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}
