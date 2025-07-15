import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

// All properties exposed by CREATE EXTENSION statement are included in diff output.
// https://www.postgresql.org/docs/current/sql-createextension.html
//
// ALTER EXTENSION statement can be generated for changes to the following properties:
//  - version (limited to available ones), schema (only if relocatable)
// https://www.postgresql.org/docs/current/sql-alterextension.html
//
// Adding or dropping member objects are not supported. For eg. pgmq allows detaching
// user defined queues by removing its entry from pg_depend. If the detached table
// lives in an excluded schema like pg_catalog, it will not be diffed.
//
// The extension's configuration tables are not diffed.
//  - extconfig, extcondition
// https://www.postgresql.org/docs/current/catalog-pg-extension.html
interface InspectedExtensionRow {
  name: string;
  schema: string;
  relocatable: boolean;
  version: string;
  owner: string;
}

export type InspectedExtension = InspectedExtensionRow &
  DependentDatabaseObject;

function identifyExtension(extension: InspectedExtensionRow): string {
  return `${extension.schema}.${extension.name}`;
}

export async function inspectExtensions(
  sql: Sql,
): Promise<Record<string, InspectedExtension>> {
  const extensions = await sql<InspectedExtensionRow[]>`
select
  extname as name,
  extnamespace::regnamespace as schema,
  extrelocatable as relocatable,
  extversion as version,
  extowner::regrole as owner
from
  pg_catalog.pg_extension e
order by
  1;
  `;

  return Object.fromEntries(
    extensions.map((e) => [
      identifyExtension(e),
      {
        ...e,
        dependent_on: [],
        dependents: [],
      },
    ]),
  );
}
