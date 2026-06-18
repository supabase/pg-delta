import type { PostgresRelationship } from "../types.ts";
import type { IntrospectOptions, Queryable } from "./index.ts";
import { DEFAULT_SYSTEM_SCHEMAS, filterByList } from "./sql/helpers.ts";
import { TABLE_RELATIONSHIPS_SQL } from "./sql/table_relationships.sql.ts";
import { VIEWS_KEY_DEPENDENCIES_SQL } from "./sql/views_key_dependencies.sql.ts";

/**
 * Port of `postgres-meta/src/lib/PostgresMetaRelationships.ts`.
 *
 * The relationships used for type generation come in two parts:
 *  1. table↔table m2o/o2o relationships, read directly from `pg_constraint`
 *     (`TABLE_RELATIONSHIPS_SQL`); and
 *  2. relationships that involve a view on either side, which PostgREST derives
 *     by mapping a base table's foreign key columns onto the view columns that
 *     select them (`VIEWS_KEY_DEPENDENCIES_SQL` + the cartesian-product
 *     expansion below). This second part is pure TypeScript, not SQL — ported
 *     verbatim from upstream.
 *
 * Adapted from:
 * https://github.com/PostgREST/postgrest/blob/f9f0f79fa914ac00c11fbf7f4c558e14821e67e2/src/PostgREST/SchemaCache.hs#L392
 */

type ColDep = {
  table_column: string;
  view_columns: string[];
};

export type ViewKeyDependency = {
  table_schema: string;
  table_name: string;
  view_schema: string;
  view_name: string;
  constraint_name: string;
  constraint_type: "f" | "f_ref" | "p" | "p_ref";
  column_dependencies: ColDep[];
};

/**
 * Expand the table↔table relationships into the view↔table / table↔view /
 * view↔view relationships implied by the view key dependencies. Pure function
 * (no database) so the cartesian-product expansion can be unit-tested directly.
 *
 * Ported verbatim from `PostgresMetaRelationships.list()` (the body of the
 * `allViewM2oAndO2oRelationships` block).
 */
export function expandViewRelationships(
  allTableM2oAndO2oRelationships: PostgresRelationship[],
  viewsKeyDependencies: ViewKeyDependency[],
): PostgresRelationship[] {
  return allTableM2oAndO2oRelationships.flatMap((r) => {
    const expandKeyDepCols = (
      colDeps: ColDep[],
    ): { tableColumns: string[]; viewColumns: string[] }[] => {
      const tableColumns = colDeps.map(({ table_column }) => table_column);
      // https://gist.github.com/ssippe/1f92625532eef28be6974f898efb23ef?permalink_comment_id=3474581#gistcomment-3474581
      const cartesianProduct = <T>(allEntries: T[][]): T[][] => {
        return allEntries.reduce<T[][]>(
          (results, entries) =>
            results
              .map((result) => entries.map((entry) => result.concat(entry)))
              .reduce((subResults, result) => subResults.concat(result), []),
          [[]],
        );
      };
      const viewColumnsPermutations = cartesianProduct(
        colDeps.map((cd) => cd.view_columns),
      );
      return viewColumnsPermutations.map((viewColumns) => ({
        tableColumns,
        viewColumns,
      }));
    };

    const viewToTableKeyDeps = viewsKeyDependencies.filter(
      (vkd) =>
        vkd.table_schema === r.schema &&
        vkd.table_name === r.relation &&
        vkd.constraint_name === r.foreign_key_name &&
        vkd.constraint_type === "f",
    );
    const tableToViewKeyDeps = viewsKeyDependencies.filter(
      (vkd) =>
        vkd.table_schema === r.referenced_schema &&
        vkd.table_name === r.referenced_relation &&
        vkd.constraint_name === r.foreign_key_name &&
        vkd.constraint_type === "f_ref",
    );

    const viewToTableRelationships = viewToTableKeyDeps.flatMap((vtkd) =>
      expandKeyDepCols(vtkd.column_dependencies).map(({ viewColumns }) => ({
        foreign_key_name: r.foreign_key_name,
        schema: vtkd.view_schema,
        relation: vtkd.view_name,
        columns: viewColumns,
        is_one_to_one: r.is_one_to_one,
        referenced_schema: r.referenced_schema,
        referenced_relation: r.referenced_relation,
        referenced_columns: r.referenced_columns,
      })),
    );

    const tableToViewRelationships = tableToViewKeyDeps.flatMap((tvkd) =>
      expandKeyDepCols(tvkd.column_dependencies).map(({ viewColumns }) => ({
        foreign_key_name: r.foreign_key_name,
        schema: r.schema,
        relation: r.relation,
        columns: r.columns,
        is_one_to_one: r.is_one_to_one,
        referenced_schema: tvkd.view_schema,
        referenced_relation: tvkd.view_name,
        referenced_columns: viewColumns,
      })),
    );

    const viewToViewRelationships = viewToTableKeyDeps.flatMap((vtkd) =>
      expandKeyDepCols(vtkd.column_dependencies).flatMap(({ viewColumns }) =>
        tableToViewKeyDeps.flatMap((tvkd) =>
          expandKeyDepCols(tvkd.column_dependencies).map(
            ({ viewColumns: referencedViewColumns }) => ({
              foreign_key_name: r.foreign_key_name,
              schema: vtkd.view_schema,
              relation: vtkd.view_name,
              columns: viewColumns,
              is_one_to_one: r.is_one_to_one,
              referenced_schema: tvkd.view_schema,
              referenced_relation: tvkd.view_name,
              referenced_columns: referencedViewColumns,
            }),
          ),
        ),
      ),
    );

    return [
      ...viewToTableRelationships,
      ...tableToViewRelationships,
      ...viewToViewRelationships,
    ];
  });
}

/**
 * List all relationships (table↔table plus the view-derived ones) for the
 * given schema filter. Mirrors `PostgresMetaRelationships.list()` with the
 * generator path's defaults (`includeSystemSchemas: false`). Errors from the
 * injected `Queryable` propagate by throwing — callers adapt.
 */
export async function listRelationships(
  db: Queryable,
  { includedSchemas, excludedSchemas }: IntrospectOptions = {},
): Promise<PostgresRelationship[]> {
  const schemaFilter = filterByList(
    includedSchemas,
    excludedSchemas,
    DEFAULT_SYSTEM_SCHEMAS,
  );

  const { rows: allTableM2oAndO2oRelationships } = await db.query(
    TABLE_RELATIONSHIPS_SQL({ schemaFilter }),
  );
  const { rows: viewsKeyDependencies } = await db.query(
    VIEWS_KEY_DEPENDENCIES_SQL({ schemaFilter }),
  );

  const allViewM2oAndO2oRelationships = expandViewRelationships(
    allTableM2oAndO2oRelationships as PostgresRelationship[],
    viewsKeyDependencies as ViewKeyDependency[],
  );

  return (allTableM2oAndO2oRelationships as PostgresRelationship[]).concat(
    allViewM2oAndO2oRelationships,
  );
}
