import {
  formatColumnList,
  formatKeyValueItems,
  formatListItems,
  formatMixedItems,
  indentString,
  joinHeaderAndClauses,
} from "./format-utils.ts";
import {
  findClausePositions,
  findTopLevelParen,
  identifierEnd,
  qualifiedNameEnd,
  scanTokens,
  skipQualifiedName,
  sliceClauses,
  splitByCommas,
} from "./tokenizer.ts";
import type { NormalizedOptions, Token } from "./types.ts";

// ── Module-level keyword sets (hoisted to avoid per-call allocations) ────────

const DOMAIN_CLAUSE_KEYWORDS = new Set(["COLLATE", "DEFAULT", "CHECK"]);

const FUNCTION_CLAUSE_KEYWORDS = new Set([
  "RETURNS",
  "LANGUAGE",
  "TRANSFORM",
  "WINDOW",
  "IMMUTABLE",
  "STABLE",
  "VOLATILE",
  "LEAKPROOF",
  "CALLED",
  "STRICT",
  "SECURITY",
  "PARALLEL",
  "COST",
  "ROWS",
  "SUPPORT",
  "SET",
  "AS",
]);

const POLICY_CLAUSE_KEYWORDS = new Set(["FOR", "TO", "USING", "WITH"]);

const TRIGGER_CLAUSE_KEYWORDS = new Set([
  "BEFORE",
  "AFTER",
  "INSTEAD",
  "FOR",
  "WHEN",
  "EXECUTE",
]);
const EVENT_TRIGGER_CLAUSE_KEYWORDS = new Set(["ON", "WHEN", "EXECUTE"]);

const INDEX_CLAUSE_KEYWORDS = new Set(["WHERE", "WITH", "TABLESPACE"]);

const LANGUAGE_CLAUSE_KEYWORDS = new Set(["HANDLER", "INLINE", "VALIDATOR"]);

// pre-AS matview clauses (USING <access method>, TABLESPACE) must be preserved
// as their own header clauses; otherwise sliceClauses drops the text before the
// first recognized clause (the AS body), silently changing the access method.
const MATVIEW_CLAUSE_KEYWORDS = new Set(["USING", "TABLESPACE", "WITH", "AS"]);

const SUBSCRIPTION_CLAUSE_KEYWORDS = new Set([
  "CONNECTION",
  "PUBLICATION",
  "WITH",
]);

const FDW_CLAUSE_KEYWORDS = new Set(["HANDLER", "VALIDATOR", "OPTIONS"]);

const EXPANDABLE_KEYWORDS = new Set(["OPTIONS", "WITH", "SET"]);

// ── Formatters ───────────────────────────────────────────────────────────────

export function formatCreateDomain(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 2) return null;
  const t0 = tokens[0];
  const t1 = tokens[1];
  if (t0 === undefined || t1 === undefined) return null;
  if (t0.upper !== "CREATE" || t1.upper !== "DOMAIN") {
    return null;
  }

  // Domain has a special NOT NULL compound clause that findClausePositions
  // can't handle generically, so we keep a custom scan here.
  const clauseStarts: number[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok === undefined) continue;
    if (tok.depth !== 0) continue;

    const upper = tok.upper;
    if (DOMAIN_CLAUSE_KEYWORDS.has(upper)) {
      clauseStarts.push(tok.start);
      continue;
    }
    if (
      upper === "NOT" &&
      tokens[i + 1]?.upper === "NULL" &&
      tokens[i + 1]?.depth === 0
    ) {
      clauseStarts.push(tok.start);
      i += 1;
    }
  }

  if (clauseStarts.length === 0) return null;
  clauseStarts.sort((a, b) => a - b);

  const prefix = statement.slice(0, clauseStarts[0]).trim();
  const clauses = sliceClauses(statement, clauseStarts);

  return joinHeaderAndClauses(prefix, clauses, options);
}

export function formatCreateEnum(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 4) return null;
  const t0 = tokens[0];
  const t1 = tokens[1];
  if (t0 === undefined || t1 === undefined) return null;
  if (t0.upper !== "CREATE" || t1.upper !== "TYPE") {
    return null;
  }

  const enumToken = tokens.find(
    (token, index) =>
      token.upper === "ENUM" && tokens[index - 1]?.upper === "AS",
  );
  if (!enumToken) return null;

  const parens = findTopLevelParen(statement, enumToken.end);
  if (!parens) return null;
  const { open, close } = parens;

  const header = statement.slice(0, open).trim();
  const content = statement.slice(open + 1, close).trim();
  const suffix = statement.slice(close + 1).trim();

  const items = splitByCommas(content);
  const indent = indentString(options.indent);
  const listLines = formatListItems(items, indent, options.commaStyle);

  const lines = [`${header} (`, ...listLines, `)${suffix ? ` ${suffix}` : ""}`];
  return lines.join("\n");
}

export function formatCreateCompositeType(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  {
    const t0 = tokens[0];
    const t1 = tokens[1];
    if (t0 === undefined || t1 === undefined) return null;
    if (t0.upper !== "CREATE" || t1.upper !== "TYPE") {
      return null;
    }
  }

  const asToken = tokens.find((token) => token.upper === "AS");
  if (!asToken) return null;
  const asIndex = tokens.indexOf(asToken);
  const nextToken = tokens[asIndex + 1];
  if (nextToken?.upper === "ENUM" || nextToken?.upper === "RANGE") {
    return null;
  }
  const parens = findTopLevelParen(statement, asToken.end);
  if (!parens) return null;

  const { open, close } = parens;
  const header = statement.slice(0, open).trim();
  const content = statement.slice(open + 1, close).trim();
  const suffix = statement.slice(close + 1).trim();

  const formattedColumns = formatColumnList(content, options);
  if (!formattedColumns) return null;

  const lines = [
    `${header} (`,
    ...formattedColumns,
    `)${suffix ? ` ${suffix}` : ""}`,
  ];
  return lines.join("\n");
}

export function formatCreateTable(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0]?.upper !== "CREATE") return null;

  const tableToken = tokens.find((token, index) => {
    if (token.upper !== "TABLE") return false;
    if (index > 0 && tokens[index - 1]?.upper === "RETURNS") return false;
    return true;
  });
  if (!tableToken) return null;

  const parens = findTopLevelParen(statement, tableToken.end);
  if (!parens) return null;

  const { open, close } = parens;
  const hasPartitionBeforeColumns = tokens.some(
    (token) =>
      token.depth === 0 && token.upper === "PARTITION" && token.start < open,
  );
  if (hasPartitionBeforeColumns) return null;
  const header = statement.slice(0, open).trim();
  const content = statement.slice(open + 1, close).trim();
  const suffix = statement.slice(close + 1).trim();

  const formattedColumns = formatColumnList(content, options);
  if (!formattedColumns) return null;

  const lines = [
    `${header} (`,
    ...formattedColumns,
    `)${suffix ? ` ${suffix}` : ""}`,
  ];
  return lines.join("\n");
}

export function formatCreateRange(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 4) return null;
  const t0 = tokens[0];
  const t1 = tokens[1];
  if (t0 === undefined || t1 === undefined) return null;
  if (t0.upper !== "CREATE" || t1.upper !== "TYPE") {
    return null;
  }

  const rangeToken = tokens.find(
    (token, index) =>
      token.upper === "RANGE" && tokens[index - 1]?.upper === "AS",
  );
  if (!rangeToken) return null;

  const parens = findTopLevelParen(statement, rangeToken.end);
  if (!parens) return null;
  const { open, close } = parens;

  const header = statement.slice(0, open).trim();
  const content = statement.slice(open + 1, close).trim();
  const suffix = statement.slice(close + 1).trim();

  const items = splitByCommas(content);
  if (items.length === 0) return null;

  const formattedItems = formatKeyValueItems(items, options);
  const lines = [
    `${header} (`,
    ...formattedItems,
    `)${suffix ? ` ${suffix}` : ""}`,
  ];
  return lines.join("\n");
}

export function formatCreateCollation(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  const t0 = tokens[0];
  const t1 = tokens[1];
  if (t0 === undefined || t1 === undefined) return null;
  if (t0.upper !== "CREATE" || t1.upper !== "COLLATION") {
    return null;
  }

  const parens = findTopLevelParen(statement, t1.end);
  if (!parens) return null;
  const { open, close } = parens;

  const header = statement.slice(0, open).trim();
  const content = statement.slice(open + 1, close).trim();
  const suffix = statement.slice(close + 1).trim();

  const items = splitByCommas(content);
  if (items.length === 0) return null;

  const formattedItems = formatKeyValueItems(items, options);
  const lines = [
    `${header} (`,
    ...formattedItems,
    `)${suffix ? ` ${suffix}` : ""}`,
  ];
  return lines.join("\n");
}

export function formatCreateFunction(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0]?.upper !== "CREATE") return null;

  let cursor = 1;
  if (
    tokens[cursor]?.upper === "OR" &&
    tokens[cursor + 1]?.upper === "REPLACE"
  ) {
    cursor += 2;
  }
  const objectToken = tokens[cursor];
  if (
    !objectToken ||
    (objectToken.upper !== "FUNCTION" && objectToken.upper !== "PROCEDURE")
  ) {
    return null;
  }

  const parens = findTopLevelParen(statement, objectToken.end);
  if (!parens) return null;
  const { open, close } = parens;

  const header = statement.slice(0, open).trim();
  const argContent = statement.slice(open + 1, close).trim();
  const postArgs = statement.slice(close + 1).trim();

  const indent = indentString(options.indent);
  const lines: string[] = [];

  if (argContent.length === 0) {
    lines.push(`${header}()`);
  } else {
    const formattedArgs = formatColumnList(argContent, options);
    if (formattedArgs) {
      lines.push(`${header} (`, ...formattedArgs, `)`);
    } else {
      lines.push(`${header}(${argContent})`);
    }
  }

  if (postArgs.length === 0) {
    return lines.join("\n");
  }

  // Function/procedure has special compound clauses (NOT LEAKPROOF, placeholders)
  // that require a custom scan rather than the generic findClausePositions.
  const postTokens = scanTokens(postArgs);
  const clauseStarts: number[] = [];

  for (let i = 0; i < postTokens.length; i += 1) {
    const tok = postTokens[i];
    if (tok === undefined) continue;
    if (tok.depth !== 0) continue;
    // a token that is the tail of a schema-qualified name (preceded by `.`) is
    // an identifier, not a clause keyword — e.g. a RETURNS type `public.cost`
    // must not be split on the COST function-clause keyword (review P2).
    if (postArgs[tok.start - 1] === ".") continue;

    if (tok.upper === "NOT" && postTokens[i + 1]?.upper === "LEAKPROOF") {
      clauseStarts.push(tok.start);
      i += 1;
      continue;
    }

    if (FUNCTION_CLAUSE_KEYWORDS.has(tok.upper)) {
      clauseStarts.push(tok.start);
      continue;
    }
    if (tok.value.startsWith("__PGDELTA_PLACEHOLDER_")) {
      clauseStarts.push(tok.start);
    }
  }

  if (clauseStarts.length === 0) {
    lines[lines.length - 1] += ` ${postArgs}`;
    return lines.join("\n");
  }

  clauseStarts.sort((a, b) => a - b);

  const beforeFirstClause = postArgs.slice(0, clauseStarts[0]).trim();
  if (beforeFirstClause.length > 0) {
    lines[lines.length - 1] += ` ${beforeFirstClause}`;
  }

  const clauses = sliceClauses(postArgs, clauseStarts);
  for (const clause of clauses) {
    const clauseTokens = scanTokens(clause);
    const ct0 = clauseTokens[0];
    const ct1 = clauseTokens[1];
    if (
      clauseTokens.length >= 2 &&
      ct0 !== undefined &&
      ct1 !== undefined &&
      ct0.upper === "RETURNS" &&
      ct1.upper === "TABLE"
    ) {
      const tableParens = findTopLevelParen(clause, ct1.end);
      if (tableParens) {
        const innerContent = clause
          .slice(tableParens.open + 1, tableParens.close)
          .trim();
        const afterTable = clause.slice(tableParens.close + 1).trim();

        if (innerContent.length > 0) {
          const formattedCols = formatColumnList(innerContent, {
            ...options,
            indent: options.indent * 2,
          });
          if (formattedCols) {
            lines.push(
              `${indent}RETURNS TABLE (`,
              ...formattedCols,
              `${indent})`,
            );
          } else {
            lines.push(`${indent}RETURNS TABLE (${innerContent})`);
          }
        } else {
          lines.push(`${indent}RETURNS TABLE ()`);
        }
        if (afterTable.length > 0) {
          lines[lines.length - 1] += ` ${afterTable}`;
        }
        continue;
      }
    }

    lines.push(`${indent}${clause}`);
  }

  return lines.join("\n");
}

export function formatCreatePolicy(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  const t0 = tokens[0];
  const t1 = tokens[1];
  if (t0 === undefined || t1 === undefined) return null;
  if (t0.upper !== "CREATE" || t1.upper !== "POLICY") {
    return null;
  }

  // Policy has special WITH CHECK handling that requires a custom scan.
  const clauseStarts: number[] = [];
  for (let i = 2; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok === undefined) continue;
    if (tok.depth !== 0) continue;
    const upper = tok.upper;

    if (
      upper === "AS" &&
      (tokens[i + 1]?.upper === "PERMISSIVE" ||
        tokens[i + 1]?.upper === "RESTRICTIVE")
    ) {
      clauseStarts.push(tok.start);
      continue;
    }
    if (upper === "WITH" && tokens[i + 1]?.upper === "CHECK") {
      clauseStarts.push(tok.start);
      continue;
    }
    if (upper === "WITH") continue;
    if (POLICY_CLAUSE_KEYWORDS.has(upper)) {
      clauseStarts.push(tok.start);
    }
  }

  if (clauseStarts.length === 0) return null;
  clauseStarts.sort((a, b) => a - b);

  const header = statement.slice(0, clauseStarts[0]).trim();
  const clauses = sliceClauses(statement, clauseStarts);

  return joinHeaderAndClauses(header, clauses, options);
}

export function formatCreateTrigger(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0]?.upper !== "CREATE") return null;

  let triggerIndex = -1;
  for (let i = 1; i < Math.min(5, tokens.length); i += 1) {
    if (tokens[i]?.upper === "TRIGGER") {
      triggerIndex = i;
      break;
    }
  }
  if (triggerIndex === -1) return null;

  const triggerToken = tokens[triggerIndex];
  if (triggerToken === undefined) return null;
  // the (possibly quoted) trigger name follows TRIGGER; scan the raw statement
  // for its end rather than tokens[triggerIndex + 1], which is the next clause
  // keyword when the name is quoted (scanTokens drops quoted identifiers).
  const headerEnd = identifierEnd(statement, triggerToken.end);
  const rest = statement.slice(headerEnd).trim();
  const header = statement.slice(0, headerEnd).trim();

  if (rest.length === 0) return null;

  const restTokens = scanTokens(rest);
  const clauseKeywords =
    tokens[triggerIndex - 1]?.upper === "EVENT"
      ? EVENT_TRIGGER_CLAUSE_KEYWORDS
      : TRIGGER_CLAUSE_KEYWORDS;
  const positions = findClausePositions(rest, restTokens, clauseKeywords);
  if (positions.length === 0) return null;

  const clauses = sliceClauses(rest, positions);
  return joinHeaderAndClauses(header, clauses, options);
}

export function formatCreateIndex(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0]?.upper !== "CREATE") return null;

  let indexIndex = -1;
  for (let i = 1; i < Math.min(4, tokens.length); i += 1) {
    if (tokens[i]?.upper === "INDEX") {
      indexIndex = i;
      break;
    }
  }
  if (indexIndex === -1) return null;

  const indexToken = tokens[indexIndex];
  if (indexToken === undefined) return null;
  const parens = findTopLevelParen(statement, indexToken.end);
  if (!parens) return null;

  let headerEnd = parens.close + 1;

  const rawAfter = statement.slice(headerEnd);
  // `afterParens` is trimmed for tokenizing; remember the leading whitespace so
  // offsets computed against it map back to the original string.
  const leadWs = rawAfter.length - rawAfter.trimStart().length;
  const afterParens = rawAfter.trim();
  const afterTokens = scanTokens(afterParens);
  const afterToken0 = afterTokens[0];
  if (
    afterTokens.length > 0 &&
    afterToken0 !== undefined &&
    afterToken0.upper === "INCLUDE"
  ) {
    const includeParens = findTopLevelParen(afterParens, afterToken0.end);
    if (includeParens) {
      // include the trimmed leading whitespace, or headerEnd lands BEFORE the
      // INCLUDE list's closing paren and cuts the `)` off (review P2).
      headerEnd = headerEnd + leadWs + includeParens.close + 1;
    }
  }

  const restText = statement.slice(headerEnd).trim();
  if (restText.length === 0) return null;

  const restTokens = scanTokens(restText);
  const positions = findClausePositions(
    restText,
    restTokens,
    INDEX_CLAUSE_KEYWORDS,
  );
  if (positions.length === 0) return null;

  // Text between the column/INCLUDE list and the first recognized clause is an
  // index modifier such as `NULLS NOT DISTINCT` — keep it on the header line.
  // sliceClauses() drops everything before positions[0], so without this the
  // modifier would be silently lost, changing the index semantics (review P2).
  const firstClauseStart = positions[0] ?? restText.length;
  const modifier = restText.slice(0, firstClauseStart).trim();
  const header = statement.slice(0, headerEnd).trim();
  const headerWithModifier =
    modifier.length > 0 ? `${header} ${modifier}` : header;
  const clauses = sliceClauses(restText, positions);
  return joinHeaderAndClauses(headerWithModifier, clauses, options);
}

export function formatAlterTable(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  {
    const t0 = tokens[0];
    const t1 = tokens[1];
    if (t0 === undefined || t1 === undefined) return null;
    if (t0.upper !== "ALTER" || t1.upper !== "TABLE") {
      return null;
    }
  }

  let cursor = 2;
  if (
    tokens[cursor]?.upper === "IF" &&
    tokens[cursor + 1]?.upper === "EXISTS"
  ) {
    cursor += 2;
  }
  if (tokens[cursor]?.upper === "ONLY") {
    cursor += 1;
  }

  if (cursor >= tokens.length) return null;

  cursor = skipQualifiedName(statement, tokens, cursor);
  if (cursor >= tokens.length) return null;

  const cursorToken = tokens[cursor];
  if (cursorToken === undefined) return null;
  const headerEnd = cursorToken.start;
  const header = statement.slice(0, headerEnd).trim();
  const action = statement.slice(headerEnd).trim();

  if (action.length === 0) return null;

  const indent = indentString(options.indent);
  return `${header}\n${indent}${action}`;
}

export function formatCreateAggregate(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  {
    const t0 = tokens[0];
    const t1 = tokens[1];
    if (t0 === undefined || t1 === undefined) return null;
    if (t0.upper !== "CREATE" || t1.upper !== "AGGREGATE") {
      return null;
    }
  }

  // Find the argument list parentheses first (e.g. array_cat_agg(anycompatiblearray))
  const aggT1 = tokens[1];
  if (aggT1 === undefined) return null;
  const argParens = findTopLevelParen(statement, aggT1.end);
  if (!argParens) return null;

  // Find the options parentheses after the argument list
  const optParens = findTopLevelParen(statement, argParens.close + 1);
  if (!optParens) return null;

  const { open, close } = optParens;
  const header = statement.slice(0, open).trim();
  const content = statement.slice(open + 1, close).trim();
  const suffix = statement.slice(close + 1).trim();

  const items = splitByCommas(content);
  if (items.length === 0) return null;

  const formattedItems = formatMixedItems(items, options);
  const lines = [
    `${header} (`,
    ...formattedItems,
    `)${suffix ? ` ${suffix}` : ""}`,
  ];
  return lines.join("\n");
}

export function formatCreateLanguage(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0]?.upper !== "CREATE") return null;

  // Find LANGUAGE token (may be preceded by TRUSTED)
  let langIndex = -1;
  for (let i = 1; i < Math.min(4, tokens.length); i += 1) {
    if (tokens[i]?.upper === "LANGUAGE") {
      langIndex = i;
      break;
    }
  }
  if (langIndex === -1) return null;

  const langToken = tokens[langIndex];
  if (langToken === undefined) return null;
  // (possibly quoted) language name follows LANGUAGE — scan the raw statement
  // for its end (tokens[langIndex + 1] is the next keyword when name is quoted).
  const headerEnd = identifierEnd(statement, langToken.end);
  const rest = statement.slice(headerEnd).trim();
  const header = statement.slice(0, headerEnd).trim();

  if (rest.length === 0) return null;

  const restTokens = scanTokens(rest);
  const positions = findClausePositions(
    rest,
    restTokens,
    LANGUAGE_CLAUSE_KEYWORDS,
  );
  if (positions.length === 0) return null;

  const clauses = sliceClauses(rest, positions);
  return joinHeaderAndClauses(header, clauses, options);
}

export function formatCreateMaterializedView(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 4) return null;
  if (tokens[0]?.upper !== "CREATE") return null;

  // Find MATERIALIZED VIEW sequence
  let viewIndex = -1;
  for (let i = 1; i < Math.min(5, tokens.length); i += 1) {
    if (
      tokens[i]?.upper === "MATERIALIZED" &&
      tokens[i + 1]?.upper === "VIEW"
    ) {
      viewIndex = i + 1; // point to VIEW
      break;
    }
  }
  if (viewIndex === -1) return null;

  // Name (possibly quoted/qualified, e.g. "s"."v") follows VIEW. scanTokens
  // drops quoted identifiers, so locate the name's end on the raw statement
  // rather than via token indexing (which would land on the WITH/AS clause and
  // drop the storage options + name).
  const viewToken = tokens[viewIndex];
  if (viewToken === undefined) return null;
  const nameEnd = qualifiedNameEnd(statement, viewToken.end);
  const rest = statement.slice(nameEnd).trim();
  const header = statement.slice(0, nameEnd).trim();

  if (rest.length === 0) return null;

  // The matview body after AS is split on clause keywords only when it has been
  // PROTECTED (preserveViewBodies, the default) — it then appears as a single
  // placeholder token. Without protection the raw SELECT contains its own
  // `AS` (column aliases) and `WITH` (CTEs / `WITH NO DATA`) which are not
  // matview clauses; splitting on them shreds the query, so fall back to generic
  // formatting (review P2).
  const restTokens = scanTokens(rest);
  const hasProtectedBody = restTokens.some((t) =>
    t.value.startsWith("__PGDELTA_PLACEHOLDER_"),
  );
  if (!hasProtectedBody) return null;

  const clauseStarts: number[] = [];
  for (let i = 0; i < restTokens.length; i += 1) {
    const rtok = restTokens[i];
    if (rtok === undefined) continue;
    if (rtok.depth !== 0) continue;
    if (rest[rtok.start - 1] === ".") continue; // qualified-name tail
    if (MATVIEW_CLAUSE_KEYWORDS.has(rtok.upper)) {
      clauseStarts.push(rtok.start);
    }
    // Handle placeholder for protected view body
    if (rtok.value.startsWith("__PGDELTA_PLACEHOLDER_")) {
      clauseStarts.push(rtok.start);
    }
  }

  if (clauseStarts.length === 0) return null;
  clauseStarts.sort((a, b) => a - b);

  const clauses = sliceClauses(rest, clauseStarts);
  return joinHeaderAndClauses(header, clauses, options);
}

export function formatCreateSubscription(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  {
    const t0 = tokens[0];
    const t1 = tokens[1];
    if (t0 === undefined || t1 === undefined) return null;
    if (t0.upper !== "CREATE" || t1.upper !== "SUBSCRIPTION") {
      return null;
    }
  }

  // (possibly quoted) name follows SUBSCRIPTION (tokens[1]); scan the raw
  // statement for its end, since tokens[2] is the first clause keyword
  // (CONNECTION) when the name is quoted (scanTokens drops quoted identifiers).
  const subToken = tokens[1];
  if (subToken === undefined) return null;
  const headerEnd = identifierEnd(statement, subToken.end);
  const rest = statement.slice(headerEnd).trim();
  const header = statement.slice(0, headerEnd).trim();

  if (rest.length === 0) return null;

  const restTokens = scanTokens(rest);
  const positions = findClausePositions(
    rest,
    restTokens,
    SUBSCRIPTION_CLAUSE_KEYWORDS,
  );
  if (positions.length === 0) return null;

  const clauses = sliceClauses(rest, positions);
  return joinHeaderAndClauses(header, clauses, options, expandOptionsClause);
}

export function formatCreateFDW(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 5) return null;
  if (tokens[0]?.upper !== "CREATE") return null;

  // Must be CREATE FOREIGN DATA WRAPPER (not CREATE SERVER ... FOREIGN DATA WRAPPER)
  if (
    tokens[1]?.upper !== "FOREIGN" ||
    tokens[2]?.upper !== "DATA" ||
    tokens[3]?.upper !== "WRAPPER"
  ) {
    return null;
  }

  // (possibly quoted) name follows WRAPPER (tokens[3]); scan the raw statement
  // for its end (tokens[4] is the next keyword when the name is quoted).
  const wrapperToken = tokens[3];
  if (wrapperToken === undefined) return null;
  const headerEnd = identifierEnd(statement, wrapperToken.end);
  const rest = statement.slice(headerEnd).trim();
  const header = statement.slice(0, headerEnd).trim();

  if (rest.length === 0) return null;

  const restTokens = scanTokens(rest);
  const positions = findClausePositions(rest, restTokens, FDW_CLAUSE_KEYWORDS);
  if (positions.length === 0) return null;

  const clauses = sliceClauses(rest, positions);
  return joinHeaderAndClauses(header, clauses, options, expandOptionsClause);
}

export function formatCreateServer(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  {
    const t0 = tokens[0];
    const t1 = tokens[1];
    if (t0 === undefined || t1 === undefined) return null;
    if (t0.upper !== "CREATE" || t1.upper !== "SERVER") {
      return null;
    }
  }

  // (possibly quoted) name follows SERVER (tokens[1]); scan the raw statement
  // for its end, since tokens[2] is the first clause keyword (FOREIGN) when the
  // name is quoted (scanTokens drops quoted identifiers).
  const serverToken = tokens[1];
  if (serverToken === undefined) return null;
  const headerEnd = identifierEnd(statement, serverToken.end);
  const rest = statement.slice(headerEnd).trim();
  const header = statement.slice(0, headerEnd).trim();

  if (rest.length === 0) return null;

  // Server has a multi-keyword clause (FOREIGN DATA WRAPPER) requiring custom scan
  const restTokens = scanTokens(rest);
  const clauseStarts: number[] = [];

  for (let i = 0; i < restTokens.length; i += 1) {
    const rtok = restTokens[i];
    if (rtok === undefined) continue;
    if (rtok.depth !== 0) continue;
    const upper = rtok.upper;
    if (upper === "TYPE" || upper === "VERSION" || upper === "OPTIONS") {
      clauseStarts.push(rtok.start);
      continue;
    }
    // Handle FOREIGN DATA WRAPPER as a clause start
    if (
      upper === "FOREIGN" &&
      restTokens[i + 1]?.upper === "DATA" &&
      restTokens[i + 2]?.upper === "WRAPPER"
    ) {
      clauseStarts.push(rtok.start);
      // Skip the FDW NAME that follows WRAPPER: an unquoted, non-reserved name
      // (e.g. `FOREIGN DATA WRAPPER options`) is itself tokenized and would be
      // misread as a TYPE/VERSION/OPTIONS clause start, dropping the name and
      // producing invalid SQL. identifierEnd handles quoted and unquoted names;
      // advance past every token that falls within DATA/WRAPPER/<name> (review P2).
      const wrapper = restTokens[i + 2];
      if (wrapper !== undefined) {
        const nameEnd = identifierEnd(rest, wrapper.end);
        while (
          i + 1 < restTokens.length &&
          (restTokens[i + 1] as Token).start < nameEnd
        ) {
          i += 1;
        }
      }
    }
  }

  if (clauseStarts.length === 0) return null;
  clauseStarts.sort((a, b) => a - b);

  const clauses = sliceClauses(rest, clauseStarts);
  return joinHeaderAndClauses(header, clauses, options, expandOptionsClause);
}

export function formatAlterGeneric(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0]?.upper !== "ALTER") return null;

  // Already handled by formatAlterTable
  if (tokens[1]?.upper === "TABLE") return null;

  // Map of ALTER types to the number of type-keyword tokens
  // e.g. ALTER DOMAIN = 1, ALTER FOREIGN DATA WRAPPER = 3, ALTER MATERIALIZED VIEW = 2
  let typeTokenCount = 0;
  const t1 = tokens[1]?.upper;

  if (t1 === "DOMAIN" || t1 === "SUBSCRIPTION" || t1 === "SERVER") {
    typeTokenCount = 1;
  } else if (t1 === "MATERIALIZED" && tokens[2]?.upper === "VIEW") {
    typeTokenCount = 2;
  } else if (t1 === "FOREIGN") {
    if (tokens[2]?.upper === "TABLE") {
      typeTokenCount = 2;
    } else if (tokens[2]?.upper === "DATA" && tokens[3]?.upper === "WRAPPER") {
      typeTokenCount = 3;
    } else {
      return null;
    }
  } else if (t1 === "EVENT" && tokens[2]?.upper === "TRIGGER") {
    typeTokenCount = 2;
  } else {
    return null;
  }

  // cursor now points to the first token after the type keywords
  let cursor = 1 + typeTokenCount;

  // Skip IF EXISTS
  if (
    tokens[cursor]?.upper === "IF" &&
    tokens[cursor + 1]?.upper === "EXISTS"
  ) {
    cursor += 2;
  }

  if (cursor >= tokens.length) return null;

  // Skip the name (may be schema-qualified)
  cursor = skipQualifiedName(statement, tokens, cursor);
  if (cursor >= tokens.length) return null;

  const alterCursorToken = tokens[cursor];
  if (alterCursorToken === undefined) return null;
  const headerEnd = alterCursorToken.start;
  const header = statement.slice(0, headerEnd).trim();
  const action = statement.slice(headerEnd).trim();

  if (action.length === 0) return null;

  const indent = indentString(options.indent);
  const expandedLines = expandOptionsClause(action, indent, options);
  return [header, ...expandedLines].join("\n");
}

/**
 * If a clause contains a parenthesized options list (e.g. OPTIONS(...), WITH(...), SET(...))
 * and it has multiple comma-separated items, expand them one per line.
 * Returns an array of properly indented lines that should be pushed directly into the output.
 *
 * Also used as a `clauseTransform` callback for `joinHeaderAndClauses`.
 */
function expandOptionsClause(
  clause: string,
  baseIndent: string,
  options: NormalizedOptions,
): string[] {
  const clauseTokens = scanTokens(clause);
  if (clauseTokens.length === 0) return [`${baseIndent}${clause}`];

  const clauseToken0 = clauseTokens[0];
  if (clauseToken0 === undefined) return [`${baseIndent}${clause}`];
  const firstUpper = clauseToken0.upper;
  if (!EXPANDABLE_KEYWORDS.has(firstUpper)) {
    return [`${baseIndent}${clause}`];
  }

  const parens = findTopLevelParen(clause, clauseToken0.end);
  if (!parens) return [`${baseIndent}${clause}`];

  const { open, close } = parens;
  const content = clause.slice(open + 1, close).trim();
  const suffix = clause.slice(close + 1).trim();
  const keyword = clause.slice(0, open).trim();

  const items = splitByCommas(content);
  if (items.length <= 1) return [`${baseIndent}${clause}`];

  const innerIndent = `${baseIndent}${indentString(options.indent)}`;
  const formattedItems = formatMixedItems(items, options, innerIndent);
  return [
    `${baseIndent}${keyword} (`,
    ...formattedItems,
    `${baseIndent})${suffix ? ` ${suffix}` : ""}`,
  ];
}

export function formatGeneric(
  statement: string,
  _tokens: Token[],
  _options: NormalizedOptions,
): string {
  return statement.trim();
}
