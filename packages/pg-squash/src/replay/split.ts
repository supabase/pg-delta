import { parseSqlContent } from "@supabase/pg-topo";

const COPY_FROM_STDIN = /\bcopy\b[\s\S]*?\bfrom\s+stdin\b/i;
const PSQL_META = /(?:^|\n)\s*\\[a-zA-Z?]/;

/**
 * Split a migration file the way replay executes it: keep BEGIN/COMMIT
 * so authored transaction control is replayed verbatim. Unparsable COPY
 * FROM stdin / psql meta-command files run as a single query.
 */
export const splitReplayStatements = async (
  sql: string,
  file: string,
): Promise<string[]> => {
  if (COPY_FROM_STDIN.test(sql) || PSQL_META.test(sql)) {
    return [sql];
  }
  const parsed = await parseSqlContent(sql, file);
  if (parsed.diagnostics.length > 0) {
    return [sql];
  }
  if (parsed.statements.length === 0) {
    return sql.trim().length === 0 ? [] : [sql];
  }
  return parsed.statements.map((stmt) => stmt.sql);
};
