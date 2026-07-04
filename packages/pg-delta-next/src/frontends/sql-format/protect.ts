import { isEscapeStringQuoteStart, readDollarTag } from "./sql-scanner.ts";
import { scanTokens } from "./tokenizer.ts";
import type { NormalizedOptions, ProtectedSegments, Token } from "./types.ts";

type ProtectState = {
  placeholders: Map<string, string>;
  noWrapPlaceholders: Set<string>;
  counter: number;
  skipCasing: boolean;
  /** placeholder prefix guaranteed NOT to occur in the input, so
   *  `restorePlaceholders`' global replace only touches inserted tokens. */
  sentinel: string;
};

/** A placeholder prefix that does not appear anywhere in `statement`. Restore
 *  replaces placeholder tokens globally, so if the ORIGINAL SQL contained the
 *  fixed prefix verbatim (e.g. an identifier `"__PGDELTA_PLACEHOLDER_0__"`),
 *  that occurrence would be clobbered too. Extending the prefix until it is
 *  absent from the input makes the token collision-proof (review P2). */
function collisionFreeSentinel(statement: string): string {
  let sentinel = "__PGDELTA_PLACEHOLDER_";
  while (statement.includes(sentinel)) sentinel += "X_";
  return sentinel;
}

export function protectSegments(
  statement: string,
  options: NormalizedOptions,
): ProtectedSegments {
  let text = statement;
  const placeholders = new Map<string, string>();
  const noWrapPlaceholders = new Set<string>();
  const state: ProtectState = {
    placeholders,
    noWrapPlaceholders,
    counter: 0,
    skipCasing: false,
    sentinel: collisionFreeSentinel(statement),
  };

  if (options.preserveRoutineBodies) {
    ({ text } = protectTailAfterAs(text, ["FUNCTION", "PROCEDURE"], state));
  }

  if (options.preserveViewBodies) {
    ({ text } = protectTailAfterAs(text, ["VIEW"], state));
  }

  if (options.preserveRuleBodies) {
    ({ text } = protectTailAfterAs(text, ["RULE"], state));
  }

  ({ text } = protectCommentLiteral(text, state));

  ({ text } = protectDollarQuotes(text, state));

  return {
    text,
    placeholders,
    noWrapPlaceholders,
    skipCasing: state.skipCasing,
  };
}

function protectTailAfterAs(
  text: string,
  objectKeywords: string[],
  state: ProtectState,
): { text: string } {
  const tokens = scanTokens(text);
  if (tokens.length === 0) return { text };

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok.upper !== "CREATE") continue;

    let cursor = i + 1;
    if (
      tokens[cursor]?.upper === "OR" &&
      tokens[cursor + 1]?.upper === "REPLACE"
    ) {
      cursor += 2;
    }

    // Handle compound keywords: MATERIALIZED VIEW, FOREIGN TABLE, EVENT TRIGGER
    if (
      tokens[cursor]?.upper === "MATERIALIZED" ||
      tokens[cursor]?.upper === "FOREIGN" ||
      tokens[cursor]?.upper === "EVENT"
    ) {
      cursor += 1;
    }

    const objectToken = tokens[cursor];
    if (!objectToken || !objectKeywords.includes(objectToken.upper)) {
      continue;
    }

    const asToken = tokens
      .slice(cursor + 1)
      .find(
        (token) =>
          token.upper === "AS" &&
          token.depth === 0 &&
          isKeywordBoundary(text, token),
      );

    if (!asToken) continue;

    const placeholder = makePlaceholder(state.sentinel, state.counter);
    state.counter += 1;
    state.placeholders.set(placeholder, text.slice(asToken.start));
    state.noWrapPlaceholders.add(placeholder);
    const updated = `${text.slice(0, asToken.start)}${placeholder}`;
    return { text: updated };
  }

  return { text };
}

function protectCommentLiteral(
  text: string,
  state: ProtectState,
): { text: string } {
  const tokens = scanTokens(text);
  if (tokens.length < 4) return { text };
  if (tokens[0]!.upper !== "COMMENT" || tokens[1]!.upper !== "ON") {
    return { text };
  }

  const isToken = tokens
    .slice(2)
    .find((token) => token.depth === 0 && token.upper === "IS");
  if (!isToken) return { text };

  let literalStart = isToken.end;
  while (literalStart < text.length && /\s/.test(text[literalStart]!)) {
    literalStart += 1;
  }
  if (literalStart >= text.length) return { text };

  if (/^NULL\b/i.test(text.slice(literalStart))) {
    return { text };
  }

  const first = text[literalStart]!;
  let quoteStart = -1;
  let isEscapeString = false;
  if (first === "'") {
    quoteStart = literalStart;
  } else if (
    (first === "E" || first === "e") &&
    text[literalStart + 1] === "'"
  ) {
    quoteStart = literalStart + 1;
    isEscapeString = true;
  } else if (
    (first === "U" || first === "u") &&
    text[literalStart + 1] === "&" &&
    text[literalStart + 2] === "'"
  ) {
    quoteStart = literalStart + 2;
  } else {
    return { text };
  }

  let literalEnd = -1;
  let cursor = quoteStart + 1;
  while (cursor < text.length) {
    if (isEscapeString && text[cursor] === "\\") {
      const hasEscapedChar = cursor + 1 < text.length;
      cursor += hasEscapedChar ? 2 : 1;
      continue;
    }
    if (text[cursor] === "'") {
      if (text[cursor + 1] === "'") {
        cursor += 2;
        continue;
      }
      literalEnd = cursor + 1;
      break;
    }
    cursor += 1;
  }
  if (literalEnd === -1) {
    state.skipCasing = true;
    return { text };
  }

  const placeholder = makePlaceholder(state.sentinel, state.counter);
  state.counter += 1;
  state.placeholders.set(placeholder, text.slice(literalStart, literalEnd));
  const updated = `${text.slice(0, literalStart)}${placeholder}${text.slice(literalEnd)}`;
  return { text: updated };
}

function protectDollarQuotes(
  text: string,
  state: ProtectState,
): { text: string } {
  let output = "";
  let inSingleQuote = false;
  let singleQuoteEscapeMode = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      output += char;
      if (char === "\n") {
        inLineComment = false;
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        output += "*/";
        inBlockComment = false;
        i += 2;
        continue;
      }
      output += char;
      i += 1;
      continue;
    }

    if (inSingleQuote) {
      if (singleQuoteEscapeMode && char === "\\") {
        if (next !== undefined) {
          output += `\\${next}`;
          i += 2;
        } else {
          output += char;
          i += 1;
        }
        continue;
      }
      output += char;
      if (char === "'") {
        if (next === "'") {
          output += next;
          i += 2;
          continue;
        }
        inSingleQuote = false;
        singleQuoteEscapeMode = false;
      }
      i += 1;
      continue;
    }

    if (inDoubleQuote) {
      output += char;
      if (char === '"') {
        if (next === '"') {
          output += next;
          i += 2;
          continue;
        }
        inDoubleQuote = false;
      }
      i += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      output += "--";
      inLineComment = true;
      i += 2;
      continue;
    }

    if (char === "/" && next === "*") {
      output += "/*";
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      singleQuoteEscapeMode = isEscapeStringQuoteStart(text, i);
      output += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      output += char;
      i += 1;
      continue;
    }

    if (char === "$") {
      const tag = readDollarTag(text, i);
      if (tag) {
        const start = i;
        const end = text.indexOf(tag, i + tag.length);
        if (end !== -1) {
          const placeholder = makePlaceholder(state.sentinel, state.counter);
          state.counter += 1;
          state.placeholders.set(
            placeholder,
            text.slice(start, end + tag.length),
          );
          output += placeholder;
          i = end + tag.length;
          continue;
        }
        state.skipCasing = true;
        output += char;
        i += 1;
        continue;
      }
    }

    output += char;
    i += 1;
  }

  return { text: output };
}

export function restorePlaceholders(
  text: string,
  placeholders: Map<string, string>,
): string {
  let output = text;
  for (const [placeholder, value] of placeholders.entries()) {
    output = output.replaceAll(placeholder, () => value);
  }
  return output;
}

function isKeywordBoundary(statement: string, token: Token): boolean {
  const before = statement[token.start - 1];
  const after = statement[token.end];
  const isBoundary = (value: string | undefined) =>
    value === undefined || !/[A-Za-z0-9_$.]/.test(value);
  return isBoundary(before) && isBoundary(after);
}

function makePlaceholder(sentinel: string, index: number): string {
  return `${sentinel}${index}__`;
}
