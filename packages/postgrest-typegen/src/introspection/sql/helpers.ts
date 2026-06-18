import { literal } from "pg-format";

/**
 * Schemas that postgres-meta excludes by default when `includeSystemSchemas`
 * is false. Ported from `postgres-meta/src/lib/constants.ts`.
 */
export const DEFAULT_SYSTEM_SCHEMAS = [
  "information_schema",
  "pg_catalog",
  "pg_toast",
];

/**
 * Build a SQL `IN (...)` / `NOT IN (...)` fragment for an include/exclude list,
 * ported verbatim from `postgres-meta/src/lib/helpers.ts`. Values are escaped
 * with pg-format's `literal`. Returns an empty string when there is nothing to
 * filter, so callers interpolate it conditionally.
 */
export const filterByList = (
  include?: (string | number)[],
  exclude?: (string | number)[],
  defaultExclude?: (string | number)[],
) => {
  if (defaultExclude) {
    exclude = defaultExclude.concat(exclude ?? []);
  }
  if (include?.length) {
    return `IN (${include.map(literal).join(",")})`;
  } else if (exclude?.length) {
    return `NOT IN (${exclude.map(literal).join(",")})`;
  }
  return "";
};
