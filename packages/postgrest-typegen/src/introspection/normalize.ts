/**
 * int8 → number coercion replicating postgres-meta's global int8 type parser.
 *
 * postgres-meta installs `pg.types.setTypeParser(INT8, ...)` in
 * `src/lib/db.ts`, so every `bigint`/`int8` column comes back as a JS number
 * when it fits in a safe integer, and as the raw string otherwise. Stock `pg`
 * (and other drivers) instead return int8 as a string. To keep
 * `GeneratorMetadata` byte-identical regardless of driver, we re-apply that
 * exact coercion to the known int8 top-level fields after each query.
 *
 * Only top-level int8 columns need this: int8 values embedded inside `jsonb`
 * columns (e.g. `args[].type_id`, composite type attributes)
 * are decoded by the JSON parser as numbers in every driver, matching
 * postgres-meta. Composite text ids like a column's `"<oid>.<attnum>"` are not
 * safe integers, so the `Number.isSafeInteger` guard leaves them untouched —
 * exactly as postgres-meta's parser does, since that column is `text`, not
 * int8.
 */

/**
 * Top-level result columns that are `int8` across the typegen introspection
 * queries (schemas/tables/foreign-tables/views/materialized-views/columns/
 * functions/types). Field names are unique enough across these queries that a
 * name-based set faithfully reproduces the OID-based global parser.
 */
const INT8_FIELDS = [
  "id",
  "table_id",
  "type_relation_id",
  "return_type_id",
  "return_type_relation_id",
  "bytes",
  "live_rows_estimate",
  "dead_rows_estimate",
] as const;

/**
 * Coerce a single value the way postgres-meta's `setTypeParser(INT8, ...)`
 * does: parse to a number when it is a safe integer, otherwise keep the raw
 * string. Non-string values (already-numbers, `null`) pass through unchanged.
 */
export function coerceInt8Value(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const asNumber = Number(value);
  if (Number.isSafeInteger(asNumber)) {
    return asNumber;
  }
  return value;
}

/**
 * Apply {@link coerceInt8Value} to the known int8 fields of a single row,
 * mutating and returning it.
 */
export function normalizeRow<T extends Record<string, unknown>>(row: T): T {
  for (const field of INT8_FIELDS) {
    if (field in row) {
      (row as Record<string, unknown>)[field] = coerceInt8Value(row[field]);
    }
  }
  return row;
}

/** Apply {@link normalizeRow} to every row of a query result. */
export function normalizeRows<T extends Record<string, unknown>>(
  rows: T[],
): T[] {
  return rows.map(normalizeRow);
}
