export const sqlStateOf = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  if (!("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
};

/**
 * SQLSTATE 25001 (`active_sql_transaction`) — a statement that cannot run
 * inside a transaction block. Detection by effect, matching pg-delta's
 * `isNonTransactional`.
 */
export const isNonTransactional = (error: unknown): boolean => {
  if (sqlStateOf(error) === "25001") return true;
  return (
    error instanceof Error &&
    /cannot run inside a transaction block/i.test(error.message)
  );
};
