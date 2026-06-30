import { isWordChar, walkSql } from "./sql-scanner.ts";
import { scanTokens, splitByCommas } from "./tokenizer.ts";
import type { CommaStyle, NormalizedOptions } from "./types.ts";

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "";

  // Suppress statement splitting where a `;` is NOT a statement separator:
  //   1. inside parentheses — a multi-command rewrite-rule body
  //      `DO ALSO ( INSERT …; UPDATE … )` from pg_get_ruledef() carries inner
  //      `;` at paren depth > 0 (tracked via walkSql's depth);
  //   2. inside a SQL-standard `BEGIN ATOMIC … END` routine body — those
  //      semicolons are bare (not in quotes/dollar tags/parens), so we track
  //      block nesting at the code level: `BEGIN ATOMIC` and `CASE` open a
  //      block, `END` closes one.
  // A `;` only separates statements at paren depth 0 AND block depth 0.
  // Reserved words used as identifiers are double-quoted by the catalog
  // pretty-printers, so they never reach this keyword scan.
  let blockDepth = 0;
  let word = "";
  let prevKeyword = "";
  const finalizeWord = (): void => {
    if (word.length === 0) return;
    const upper = word.toUpperCase();
    if (upper === "ATOMIC" && prevKeyword === "BEGIN") {
      blockDepth += 1;
    } else if (upper === "CASE") {
      blockDepth += 1;
    } else if (upper === "END" && blockDepth > 0) {
      blockDepth -= 1;
    }
    prevKeyword = upper;
    word = "";
  };

  walkSql(
    sql,
    (_index, char, depth) => {
      if (isWordChar(char)) {
        word += char;
        buffer += char;
        return true;
      }
      // a non-word top-level char terminates the word that just accumulated
      finalizeWord();
      if (char === ";" && depth === 0 && blockDepth === 0) {
        const trimmed = trimOuterBlankLines(buffer);
        if (trimmed.length > 0) {
          statements.push(trimmed);
        }
        buffer = "";
        return true;
      }
      buffer += char;
      return true;
    },
    {
      trackDepth: true,
      onSkipped: (chunk) => {
        // a quoted/commented/dollar segment also ends the current word
        finalizeWord();
        buffer += chunk;
      },
    },
  );

  finalizeWord();
  const trailing = trimOuterBlankLines(buffer);
  if (trailing.length > 0) {
    statements.push(trailing);
  }

  return statements;
}

export function splitLeadingComments(statement: string): {
  commentLines: string[];
  body: string;
} {
  const lines = statement.split(/\r?\n/);
  const commentLines: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (!line.trim().startsWith("--") && line.trim() !== "") break;
    commentLines.push(line);
    index += 1;
  }

  const body = trimOuterBlankLines(lines.slice(index).join("\n"));
  return { commentLines, body };
}

function trimOuterBlankLines(text: string): string {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0) {
    const first = lines[0];
    if (first === undefined || first.trim().length !== 0) break;
    lines.shift();
  }
  while (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last === undefined || last.trim().length !== 0) break;
    lines.pop();
  }
  return lines.join("\n");
}

export function formatColumnList(
  content: string,
  options: NormalizedOptions,
): string[] | null {
  if (content.trim().length === 0) {
    return null;
  }

  const items = splitByCommas(content);
  if (items.length === 0) return null;

  const parsed = items.map((item) => parseDefinitionItem(item));
  const maxName = parsed.reduce(
    (max, column) => (column ? Math.max(max, column.name.length) : max),
    0,
  );
  const maxType = parsed.reduce(
    (max, column) => (column ? Math.max(max, column.type.length) : max),
    0,
  );

  const indent = indentString(options.indent);
  const lines: string[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!.trim();
    const column = parsed[index]!;

    let line = item;
    if (column) {
      const name = options.alignColumns
        ? column.name.padEnd(maxName)
        : column.name;
      const type = options.alignColumns
        ? column.type.padEnd(maxType)
        : column.type;
      line = `${name} ${type}`;
      if (column.tail) {
        line += ` ${column.tail}`;
      } else {
        line = line.trimEnd();
      }
    }

    const lineWithComma = applyCommaStyle(
      line,
      index,
      items.length,
      options.commaStyle,
    );
    lines.push(`${indent}${lineWithComma}`);
  }

  return lines;
}

type DefinitionBounds = {
  nameStart: number;
  nameEnd: number;
  typeStart: number;
  typeEnd: number;
  tailStart: number;
};

type ParsedDefinitionItem = {
  name: string;
  type: string;
  tail: string;
  bounds: DefinitionBounds;
};

export function parseDefinitionItem(
  definition: string,
): ParsedDefinitionItem | null {
  let i = 0;
  const trimmed = definition.trim();
  if (trimmed.length === 0) return null;

  let name = "";
  if (trimmed[i] === '"') {
    i += 1;
    while (i < trimmed.length) {
      if (trimmed[i] === '"') {
        if (trimmed[i + 1] === '"') {
          i += 2;
          continue;
        }
        i += 1;
        break;
      }
      i += 1;
    }
    name = trimmed.slice(0, i);
  } else {
    while (i < trimmed.length && isWordChar(trimmed[i]!)) {
      i += 1;
    }
    name = trimmed.slice(0, i);
  }

  if (name.length === 0) return null;
  const nameUpper = name.replace(/^"|"$/g, "").toUpperCase();
  const constraintStarts = new Set([
    "PRIMARY",
    "UNIQUE",
    "CHECK",
    "FOREIGN",
    "CONSTRAINT",
  ]);
  if (constraintStarts.has(nameUpper)) {
    return null;
  }

  let restStart = i;
  while (restStart < trimmed.length && /\s/.test(trimmed[restStart]!)) {
    restStart += 1;
  }
  if (restStart >= trimmed.length) return null;

  const rest = trimmed.slice(restStart);

  const boundaryKeywords = new Set([
    "COLLATE",
    "DEFAULT",
    "NOT",
    "GENERATED",
    "CONSTRAINT",
    "CHECK",
    "REFERENCES",
    "PRIMARY",
    "UNIQUE",
  ]);

  const tokens = scanTokens(rest);
  let boundaryIndex: number | null = null;

  for (const token of tokens) {
    if (token.depth !== 0) continue;
    if (boundaryKeywords.has(token.upper)) {
      boundaryIndex = token.start;
      break;
    }
  }

  let typeEnd =
    boundaryIndex === null ? trimmed.length : restStart + boundaryIndex;
  while (typeEnd > restStart && /\s/.test(trimmed[typeEnd - 1]!)) {
    typeEnd -= 1;
  }
  let tailStart = typeEnd;
  if (boundaryIndex !== null) {
    tailStart = restStart + boundaryIndex;
    while (tailStart < trimmed.length && /\s/.test(trimmed[tailStart]!)) {
      tailStart += 1;
    }
  }

  const type = trimmed.slice(restStart, typeEnd);
  const tail = boundaryIndex === null ? "" : trimmed.slice(tailStart).trim();

  if (type.length === 0) return null;

  return {
    name,
    type,
    tail,
    bounds: {
      nameStart: 0,
      nameEnd: name.length,
      typeStart: restStart,
      typeEnd,
      tailStart,
    },
  };
}

export function formatKeyValueItems(
  items: string[],
  options: NormalizedOptions,
  indentOverride?: string,
): string[] {
  const indent = indentOverride ?? indentString(options.indent);
  const parsed = items.map((item) => parseKeyValue(item));
  const maxKey = parsed.reduce(
    (max, entry) => (entry ? Math.max(max, entry.key.length) : max),
    0,
  );

  return parsed.map((entry, index) => {
    let line = items[index]!.trim();
    if (entry) {
      let key = entry.key;
      if (options.alignKeyValues) {
        key = key.padEnd(maxKey);
      }
      line = `${key} = ${entry.value}`;
    }
    const lineWithComma = applyCommaStyle(
      line,
      index,
      items.length,
      options.commaStyle,
    );
    return `${indent}${lineWithComma}`;
  });
}

function parseKeyValue(item: string): { key: string; value: string } | null {
  const trimmed = item.trim();
  if (trimmed.length === 0) return null;

  let result: { key: string; value: string } | null = null;

  walkSql(
    trimmed,
    (index, char, depth) => {
      if (char === "(" || char === ")") return true;
      if (char === "=" && depth === 0) {
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim();
        if (key.length > 0 && value.length > 0) {
          result = { key, value };
        }
        return false;
      }
      return true;
    },
    { trackDepth: true },
  );

  return result;
}

function applyCommaStyle(
  line: string,
  index: number,
  total: number,
  style: CommaStyle,
): string {
  if (style === "leading") {
    return index === 0 ? `  ${line}` : `, ${line}`;
  }
  return index < total - 1 ? `${line},` : line;
}

export function formatListItems(
  items: string[],
  indent: string,
  style: CommaStyle,
): string[] {
  return items.map((item, index) => {
    const line = item.trim();
    const lineWithComma = applyCommaStyle(line, index, items.length, style);
    return `${indent}${lineWithComma}`;
  });
}

/**
 * Format a mixed list of key-value pairs and plain items (e.g. aggregate options).
 * Items with `=` are formatted as key-value, others are formatted as-is.
 * Reuses `parseKeyValue` — items without `=` are left as-is.
 */
export function formatMixedItems(
  items: string[],
  options: NormalizedOptions,
  indentOverride?: string,
): string[] {
  const indent = indentOverride ?? indentString(options.indent);
  const parsed = items.map((item) => parseKeyValue(item));
  const maxKey = parsed.reduce(
    (max, entry) => (entry ? Math.max(max, entry.key.length) : max),
    0,
  );

  return parsed.map((entry, index) => {
    let line = items[index]!.trim();
    if (entry) {
      let key = entry.key;
      if (options.alignKeyValues) {
        key = key.padEnd(maxKey);
      }
      line = `${key} = ${entry.value}`;
    }
    const lineWithComma = applyCommaStyle(
      line,
      index,
      items.length,
      options.commaStyle,
    );
    return `${indent}${lineWithComma}`;
  });
}

/**
 * Join a header line with indented clause strings.
 * An optional `clauseTransform` can modify each clause before indenting
 * (e.g. to expand OPTIONS(...) sub-clauses).
 */
export function joinHeaderAndClauses(
  header: string,
  clauses: string[],
  options: NormalizedOptions,
  clauseTransform?: (
    clause: string,
    indent: string,
    options: NormalizedOptions,
  ) => string[],
): string {
  const indent = indentString(options.indent);
  const lines = [header];
  for (const clause of clauses) {
    if (clauseTransform) {
      lines.push(...clauseTransform(clause, indent, options));
    } else {
      lines.push(`${indent}${clause}`);
    }
  }
  return lines.join("\n");
}

export function indentString(size: number): string {
  return " ".repeat(size);
}
