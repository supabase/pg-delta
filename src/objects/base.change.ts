type ChangeKind = "create" | "drop" | "alter" | "replace";
export abstract class Change {
  abstract kind: ChangeKind;
  abstract serialize(): string;
}

export abstract class CreateChange extends Change {
  kind = "create" as const;
}

export abstract class DropChange extends Change {
  kind = "drop" as const;
}

export abstract class AlterChange extends Change {
  kind = "alter" as const;
}

export abstract class ReplaceChange extends Change {
  kind = "replace" as const;
}

// PostgreSQL reserved keywords
// Full list from https://github.com/postgres/postgres/blob/196063d6761d2c8d6f78cc03afad08efc95a0708/src/include/parser/kwlist.h
export const POSTGRES_RESERVED_KEYWORDS = new Set<string>([
  "all",
  "analyse",
  "analyze",
  "and",
  "any",
  "array",
  "as",
  "asc",
  "asymmetric",
  "both",
  "case",
  "cast",
  "check",
  "collate",
  "column",
  "concurrently",
  "constraint",
  "create",
  "cross",
  "current_catalog",
  "current_date",
  "current_role",
  "current_time",
  "current_timestamp",
  "current_user",
  "default",
  "deferrable",
  "desc",
  "distinct",
  "do",
  "else",
  "end",
  "except",
  "false",
  "fetch",
  "for",
  "foreign",
  "from",
  "grant",
  "group",
  "having",
  "ilike",
  "in",
  "initially",
  "inner",
  "intersect",
  "into",
  "is",
  "isnull",
  "join",
  "lateral",
  "leading",
  "left",
  "like",
  "limit",
  "localtime",
  "localtimestamp",
  "natural",
  "not",
  "notnull",
  "null",
  "offset",
  "on",
  "only",
  "or",
  "order",
  "outer",
  "overlaps",
  "placing",
  "primary",
  "references",
  "returning",
  "right",
  "select",
  "session_user",
  "similar",
  "some",
  "symmetric",
  "table",
  "then",
  "to",
  "trailing",
  "true",
  "union",
  "unique",
  "user",
  "using",
  "variadic",
  "when",
  "where",
  "window",
  "with",
]);

// Port of quote_identifier: https://github.com/postgres/postgres/blob/196063d6761d2c8d6f78cc03afad08efc95a0708/src/backend/utils/adt/ruleutils.c#L13022C1-L13104
export function quoteIdentifier(ident: string): string {
  // Empty string is always quoted
  if (ident.length === 0) {
    return '""';
  }

  // Check for unquoted identifier rules
  let mustQuote = false;
  const len = ident.length;

  // First char: must be [a-z_]
  const first = ident[0];
  if (!/[a-z_]/.test(first)) {
    mustQuote = true;
  } else {
    for (let i = 1; i < len; i++) {
      const c = ident[i];
      if (!/[a-z0-9_]/.test(c)) {
        mustQuote = true;
        break;
      }
    }
  }

  // Check for uppercase letters (unquoted are folded to lowercase)
  if (!mustQuote && /[A-Z]/.test(ident)) {
    mustQuote = true;
  }

  // Check for reserved keyword (case-insensitive)
  if (!mustQuote && POSTGRES_RESERVED_KEYWORDS.has(ident.toLowerCase())) {
    mustQuote = true;
  }

  if (!mustQuote) {
    return ident;
  }

  // Quote and double any embedded quotes using a template string
  return `"${ident.replace(/"/g, '""')}"`;
}
