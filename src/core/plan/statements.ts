const STATEMENT_DELIMITER = ";\n\n";

/**
 * Build a SQL script from normalized statements.
 */
export function formatSqlScript(statements: string[]): string {
  if (statements.length === 0) return "";
  return `${statements.join(STATEMENT_DELIMITER)};`;
}
