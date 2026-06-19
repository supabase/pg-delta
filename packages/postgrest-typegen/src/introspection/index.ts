import type { GeneratorMetadata } from "../types.ts";
import { normalizeRows } from "./normalize.ts";
import { listRelationships } from "./relationships.ts";
import { COLUMNS_SQL } from "./sql/columns.sql.ts";
import { FOREIGN_TABLES_SQL } from "./sql/foreign_tables.sql.ts";
import { FUNCTIONS_SQL } from "./sql/functions.sql.ts";
import { DEFAULT_SYSTEM_SCHEMAS, filterByList } from "./sql/helpers.ts";
import { MATERIALIZED_VIEWS_SQL } from "./sql/materialized_views.sql.ts";
import { SCHEMAS_SQL } from "./sql/schemas.sql.ts";
import { TABLES_SQL } from "./sql/table.sql.ts";
import { TYPES_SQL } from "./sql/types.sql.ts";
import { VIEWS_SQL } from "./sql/views.sql.ts";

/**
 * Minimal structural database interface. `pg.Pool` / `pg.Client` satisfy it,
 * as do Bun and other drivers. postgres-meta injects its forked-pg pool here,
 * keeping its own error handling on its side of the boundary. Errors throw;
 * callers adapt.
 */
export interface Queryable {
  query(sql: string): Promise<{ rows: any[] }>;
}

export interface IntrospectOptions {
  includedSchemas?: string[];
  excludedSchemas?: string[];
}

/**
 * Introspect a database into the `GeneratorMetadata` contract.
 *
 * Port of `getGeneratorMetadata` from `postgres-meta/src/lib/generators.ts`.
 * Instead of going through the `PostgresMeta*` manager classes, it calls the
 * ported SQL builders directly with the single option combination the
 * generator path uses, then applies the int8 `normalize` coercion so output is
 * identical regardless of driver. Connection lifecycle is the caller's
 * responsibility — unlike `getGeneratorMetadata`, this does not end the pool.
 */
export async function introspect(
  db: Queryable,
  opts: IntrospectOptions = {},
): Promise<GeneratorMetadata> {
  const includedSchemas = opts.includedSchemas ?? [];
  const excludedSchemas = opts.excludedSchemas ?? [];
  // Managers receive `undefined` (not an empty array) when no filter is set.
  const included = includedSchemas.length > 0 ? includedSchemas : undefined;
  const excluded = excludedSchemas.length > 0 ? excludedSchemas : undefined;

  // Most queries exclude the system schemas by default; foreign tables and
  // materialized views do not (matching the respective manager `list()` calls).
  const systemExcludingFilter = filterByList(
    included,
    excluded,
    DEFAULT_SYSTEM_SCHEMAS,
  );
  const plainFilter = filterByList(included, excluded);

  const queryRows = async (sql: string) =>
    normalizeRows((await db.query(sql)).rows);

  const schemas = await queryRows(
    SCHEMAS_SQL({
      includeSystemSchemas: false,
      nameFilter: systemExcludingFilter,
    }),
  );
  const tables = await queryRows(
    TABLES_SQL({ schemaFilter: systemExcludingFilter }),
  );
  const foreignTables = await queryRows(
    FOREIGN_TABLES_SQL({ schemaFilter: plainFilter }),
  );
  const views = await queryRows(
    VIEWS_SQL({ schemaFilter: systemExcludingFilter }),
  );
  const materializedViews = await queryRows(
    MATERIALIZED_VIEWS_SQL({ schemaFilter: plainFilter }),
  );
  const columns = await queryRows(
    COLUMNS_SQL({ schemaFilter: systemExcludingFilter }),
  );
  const relationships = await listRelationships(db, {
    includedSchemas: included,
    excludedSchemas: excluded,
  });
  const functions = await queryRows(
    FUNCTIONS_SQL({ schemaFilter: systemExcludingFilter }),
  );
  // types: includeSystemSchemas true (no schema filter), table + array types included.
  const types = await queryRows(
    TYPES_SQL({
      schemaFilter: "",
      includeTableTypes: true,
      includeArrayTypes: true,
    }),
  );

  return {
    schemas: schemas.filter(
      ({ name }) =>
        !excludedSchemas.includes(name) &&
        (includedSchemas.length === 0 || includedSchemas.includes(name)),
    ),
    tables,
    foreignTables,
    views,
    materializedViews,
    columns,
    relationships,
    functions: functions.filter(
      ({ return_type }) => !["trigger", "event_trigger"].includes(return_type),
    ),
    types,
  } as GeneratorMetadata;
}
