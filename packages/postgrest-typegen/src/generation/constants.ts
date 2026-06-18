/**
 * Type-generation constants ported verbatim from
 * `postgres-meta/src/server/constants.ts`. Only the typegen-relevant values
 * live here; server/runtime constants stay in postgres-meta.
 *
 * Consumed by the TypeScript generator's function-argument handling.
 */

// json/jsonb/text types
export const VALID_UNNAMED_FUNCTION_ARG_TYPES = new Set([114, 3802, 25]);
export const VALID_FUNCTION_ARGS_MODE = new Set(["in", "inout", "variadic"]);
