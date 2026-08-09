import { indentString } from "./format-utils.ts";
import { isWordChar, walkSql } from "./sql-scanner.ts";
import type { NormalizedOptions } from "./types.ts";

/**
 * Keywords that are preferred break points when wrapping long lines.
 * The wrapper will prefer to break just before one of these keywords
 * rather than at an arbitrary whitespace position.
 */
const WRAP_PREFERRED_KEYWORDS = new Set([
  "ADD",
  "CHECK",
  "CONNECTION",
  "CONSTRAINT",
  "DEFERRABLE",
  "FOREIGN",
  "HANDLER",
  "INCLUDE",
  "INITIALLY",
  "INLINE",
  "MATCH",
  "NOT",
  "ON",
  "OPTIONS",
  "PUBLICATION",
  "REFERENCES",
  "REFERENCING",
  "SET",
  "USING",
  "VALIDATOR",
  "WHERE",
  "WITH",
]);

export function wrapStatement(
  statement: string,
  options: NormalizedOptions,
  noWrapPlaceholders: Set<string>,
): string {
  const lines = statement.split(/\r?\n/);
  const wrapped: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith("--")) {
      wrapped.push(line);
      continue;
    }

    if (hasNoWrapPlaceholder(line, noWrapPlaceholders)) {
      wrapped.push(line);
      continue;
    }

    wrapped.push(...wrapLine(line, options));
  }

  return wrapped.join("\n");
}

function hasNoWrapPlaceholder(
  line: string,
  placeholders: Set<string>,
): boolean {
  for (const token of placeholders) {
    if (line.includes(token)) return true;
  }
  return false;
}

function wrapLine(line: string, options: NormalizedOptions): string[] {
  const maxWidth = options.maxWidth;
  if (maxWidth <= 0 || line.length <= maxWidth) {
    return [line];
  }

  const indentMatch = line.match(/^\s*/);
  const baseIndent = indentMatch ? indentMatch[0] : "";
  const continuationIndent = `${baseIndent}${indentString(options.indent)}`;

  let remaining = line;
  const output: string[] = [];

  while (remaining.length > maxWidth) {
    const breakpoint = findWrapPosition(remaining, maxWidth);
    if (breakpoint <= 0) break;

    const head = remaining.slice(0, breakpoint).trimEnd();
    const tail = remaining.slice(breakpoint).trimStart();
    output.push(head);
    const next = `${continuationIndent}${tail}`;
    if (next.length >= remaining.length) {
      remaining = next;
      break;
    }
    remaining = next;
  }

  output.push(remaining);
  return output;
}

/** Words that should not be separated from the previous word when wrapping (e.g. CREATE PUBLICATION, COMMENT ON). */
const KEEP_WITH_PREVIOUS = new Set([
  "PUBLICATION",
  "TABLE",
  "VIEW",
  "SCHEMA",
  "INDEX",
  "OR", // CREATE OR REPLACE
  "ON", // COMMENT ON
]);

function getPreviousWord(text: string, beforeIndex: number): string | null {
  let end = beforeIndex - 1;
  while (end >= 0 && (text[end] === " " || text[end] === "\t")) {
    end -= 1;
  }
  if (end < 0 || !isWordChar(text[end]!)) return null;
  let start = end;
  while (start > 0 && isWordChar(text[start - 1]!)) {
    start -= 1;
  }
  return text.slice(start, end + 1).toUpperCase();
}

function findWrapPosition(text: string, maxWidth: number): number {
  /** Last whitespace at depth 0 (preferred — avoids splitting parenthesized expressions) */
  let lastTopLevelWhitespace = -1;
  /** Last whitespace at any depth (fallback when no depth-0 break exists) */
  let lastAnyWhitespace = -1;
  let lastKeywordBoundary = -1;
  /** First (leftmost) top-level comma within maxWidth — break there so each clause gets its own line */
  let firstComma = -1;

  // Never break within the leading indent — that would produce an empty head line
  const contentStart = text.search(/\S/);
  if (contentStart < 0) return -1; // all whitespace

  walkSql(
    text,
    (index, char, depth) => {
      if (index > maxWidth) return false;

      // Skip positions within leading indent
      if (index < contentStart) return true;

      // Prefer breaking after the first top-level comma so comma-separated clauses (e.g. publication tables) each get their own line
      if (char === "," && depth === 0 && firstComma < 0) {
        firstComma = index + 1; // position after the comma
      }

      if (char === " " || char === "\t") {
        lastAnyWhitespace = index;
        if (depth === 0) {
          lastTopLevelWhitespace = index;
        }

        // Check if the next word is a preferred keyword
        const nextWordStart = index + 1;
        if (nextWordStart < text.length && isWordChar(text[nextWordStart]!)) {
          let wordEnd = nextWordStart + 1;
          while (wordEnd < text.length && isWordChar(text[wordEnd]!)) {
            wordEnd += 1;
          }
          const word = text.slice(nextWordStart, wordEnd).toUpperCase();
          if (WRAP_PREFERRED_KEYWORDS.has(word)) {
            // Don't break between CREATE and object type, COMMENT and ON, or ALL and ON (GRANT/REVOKE ALL ON)
            const prev = getPreviousWord(text, index);
            if (
              prev !== null &&
              ((prev === "CREATE" && KEEP_WITH_PREVIOUS.has(word)) ||
                ((prev === "COMMENT" || prev === "ALL") && word === "ON"))
            ) {
              return true;
            }
            lastKeywordBoundary = index;
          }
        }
      }
      return true;
    },
    { trackDepth: true },
  );

  // Prefer: 1) comma, 2) keyword boundary, 3) depth-0 whitespace, 4) any whitespace
  if (firstComma > 0 && firstComma <= maxWidth) {
    return firstComma;
  }
  if (lastKeywordBoundary > 0 && lastKeywordBoundary <= maxWidth) {
    return lastKeywordBoundary;
  }
  if (lastTopLevelWhitespace > 0) {
    return lastTopLevelWhitespace;
  }
  return lastAnyWhitespace;
}
