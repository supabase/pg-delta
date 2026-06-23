/**
 * Unified SQL scanner that handles quote/comment/dollar-tag state machines.
 */

/**
 * Callback invoked for each character that is NOT inside a quoted string,
 * comment, or dollar-quoted block.
 *
 * @param index - position in the text
 * @param char - the character at that position
 * @param depth - current parenthesis depth (only tracked when `trackDepth` is true, else always 0)
 * @returns `false` to stop walking early; `true` to continue
 */
type WalkCallback = (index: number, char: string, depth: number) => boolean;

type WalkSqlOptions = {
  /** Track parenthesis depth and pass it to the callback. Default: false */
  trackDepth?: boolean;
  /** Start scanning from this index. Default: 0 */
  startIndex?: number;
  /**
   * Called for characters/sequences inside quoted strings, comments, and
   * dollar-quoted blocks (i.e., characters the walker "skips" over).
   * Also called for quote/comment opener sequences (e.g., `--`, `/*`, `'`, `"`).
   *
   * NOT called for top-level characters — those go only to `onTopLevel`.
   *
   * For multi-char sequences (block comment open/close, dollar tags, escaped quotes),
   * called once with the full sequence.
   */
  onSkipped?: (chunk: string) => void;
  /**
   * Called once for each top-level double-quoted identifier, after its closing
   * quote, with the index of the opening quote (`start`), the index just past
   * the closing quote (`end`), and the parenthesis depth at the quote.
   *
   * Lets callers treat a quoted identifier (e.g. `"my-trigger"`) as an atomic
   * token even though its interior is reported via `onSkipped`. Returning
   * `false` stops the walk early, like `onTopLevel`.
   */
  onQuotedIdentifier?: (start: number, end: number, depth: number) => boolean;
};

/**
 * Fast character-code check: A-Z, a-z, 0-9, _
 */
export function isWordChar(char: string): boolean {
  const c = char.charCodeAt(0);
  return (
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) ||
    c === 95
  );
}

/**
 * Return true when the single quote at `quoteIndex` starts a PostgreSQL
 * escape string literal (`E'...'`). Only E-strings use backslash escaping;
 * U&-strings use standard '' quoting (backslash is for Unicode escapes only).
 */
export function isEscapeStringQuoteStart(
  text: string,
  quoteIndex: number,
): boolean {
  if (text[quoteIndex] !== "'") return false;

  const prev = text[quoteIndex - 1];
  const prev2 = text[quoteIndex - 2];

  if (
    (prev === "E" || prev === "e") &&
    (prev2 === undefined || !isWordChar(prev2))
  ) {
    return true;
  }

  return false;
}

/**
 * Read a dollar-quote tag starting at `start` (which must be `$`).
 * Returns the full tag including both `$` delimiters, e.g. `$$` or `$fn$`.
 */
export function readDollarTag(text: string, start: number): string | null {
  if (text[start] !== "$") return null;
  let i = start + 1;
  while (i < text.length && isWordChar(text[i])) {
    i += 1;
  }
  if (text[i] === "$") {
    return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Walk through SQL text, calling `onTopLevel` for each character that is
 * outside of quotes, comments, and dollar-quoted blocks.
 *
 * The walker handles:
 * - Single-quoted strings (with '' escaping)
 * - Double-quoted identifiers (with "" escaping)
 * - Line comments (--)
 * - Block comments (/* ... * /)
 * - Dollar-quoted strings ($tag$...$tag$)
 * - Parenthesis depth tracking (optional)
 */
export function walkSql(
  text: string,
  onTopLevel: WalkCallback,
  options?: WalkSqlOptions,
): void {
  const trackDepth = options?.trackDepth ?? false;
  const startIndex = options?.startIndex ?? 0;
  const onSkipped = options?.onSkipped;
  const onQuotedIdentifier = options?.onQuotedIdentifier;

  let inSingleQuote = false;
  let singleQuoteEscapeMode = false;
  let inDoubleQuote = false;
  let doubleQuoteStart = -1;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;
  let depth = 0;

  let i = startIndex;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    // --- Inside line comment ---
    if (inLineComment) {
      onSkipped?.(char);
      if (char === "\n") inLineComment = false;
      i += 1;
      continue;
    }

    // --- Inside block comment ---
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        onSkipped?.("*/");
        inBlockComment = false;
        i += 2;
        continue;
      }
      onSkipped?.(char);
      i += 1;
      continue;
    }

    // --- Inside dollar-quoted string ---
    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) {
        onSkipped?.(dollarTag);
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      onSkipped?.(char);
      i += 1;
      continue;
    }

    // --- Inside single-quoted string ---
    if (inSingleQuote) {
      if (singleQuoteEscapeMode && char === "\\") {
        if (next !== undefined) {
          onSkipped?.(`\\${next}`);
          i += 2;
        } else {
          onSkipped?.(char);
          i += 1;
        }
        continue;
      }
      if (char === "'") {
        if (next === "'") {
          onSkipped?.("''");
          i += 2;
          continue;
        }
        inSingleQuote = false;
        singleQuoteEscapeMode = false;
      }
      onSkipped?.(char);
      i += 1;
      continue;
    }

    // --- Inside double-quoted identifier ---
    if (inDoubleQuote) {
      if (char === '"') {
        if (next === '"') {
          onSkipped?.('""');
          i += 2;
          continue;
        }
        inDoubleQuote = false;
        onSkipped?.(char);
        if (onQuotedIdentifier?.(doubleQuoteStart, i + 1, depth) === false) {
          return;
        }
        i += 1;
        continue;
      }
      onSkipped?.(char);
      i += 1;
      continue;
    }

    // --- Top-level: check for quote/comment openers ---
    if (char === "-" && next === "-") {
      onSkipped?.("--");
      inLineComment = true;
      i += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      onSkipped?.("/*");
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (char === "'") {
      inSingleQuote = true;
      singleQuoteEscapeMode = isEscapeStringQuoteStart(text, i);
      onSkipped?.(char);
      i += 1;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      doubleQuoteStart = i;
      onSkipped?.(char);
      i += 1;
      continue;
    }
    if (char === "$") {
      const tag = readDollarTag(text, i);
      if (tag) {
        dollarTag = tag;
        onSkipped?.(tag);
        i += tag.length;
        continue;
      }
    }

    // --- Depth tracking ---
    if (trackDepth) {
      if (char === "(") {
        depth += 1;
        if (onTopLevel(i, char, depth - 1) === false) return;
        i += 1;
        continue;
      }
      if (char === ")") {
        depth = Math.max(0, depth - 1);
        if (onTopLevel(i, char, depth) === false) return;
        i += 1;
        continue;
      }
    }

    // --- Top-level character: invoke callback ---
    if (onTopLevel(i, char, depth) === false) return;
    i += 1;
  }
}
