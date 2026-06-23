import { isWordChar, walkSql } from "./sql-scanner.ts";
import type { Token } from "./types.ts";

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
        while (end < statement.length && isWordChar(statement[end])) {
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
    {
      trackDepth: true,
      // Double-quoted identifiers (e.g. `"my-trigger"`) are atomic tokens too.
      // Without this, the walker skips their interior entirely and positional
      // token logic (e.g. "the name follows the TRIGGER keyword") lands on the
      // wrong token. The value keeps the surrounding quotes; a quoted
      // identifier never matches a keyword, which is correct.
      onQuotedIdentifier: (start, end, depth) => {
        const value = statement.slice(start, end);
        tokens.push({
          value,
          upper: value.toUpperCase(),
          start,
          end,
          depth,
        });
        skipUntil = end;
        return true;
      },
    },
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
    if (tokens[i].depth !== 0) continue;
    if (keywords.has(tokens[i].upper)) {
      positions.push(tokens[i].start);
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
  while (
    c < tokens.length &&
    tokens[c].start === tokens[c - 1].end + 1 &&
    statement[tokens[c - 1].end] === "."
  ) {
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
