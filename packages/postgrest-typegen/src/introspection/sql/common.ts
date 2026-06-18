/**
 * Shared prop shapes for the SQL builders, ported from
 * `postgres-meta/src/lib/sql/common.ts`. Only the variants used by the
 * typegen introspection path are kept.
 */
export type SQLQueryProps = {
  limit?: number;
  offset?: number;
};

export type SQLQueryPropsWithSchemaFilter = SQLQueryProps & {
  schemaFilter?: string;
};

export type SQLQueryPropsWithSchemaFilterAndIdsFilter = SQLQueryProps & {
  schemaFilter?: string;
  idsFilter?: string;
};
