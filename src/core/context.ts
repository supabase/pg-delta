import type { Sql } from "postgres";
import type { Catalog } from "./catalog.model.ts";

/**
 * Context for diff operations, containing both source and target catalogs.
 */
export interface DiffContext {
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}

export async function extractVersion(sql: Sql) {
  const [{ version }] = await sql<{ version: number }[]>`
    select current_setting('server_version_num')::int as version;
  `;

  return version;
}

export async function extractCurrentUser(sql: Sql) {
  const [{ current_user }] = await sql<{ current_user: string }[]>`
    select quote_ident(current_user) as current_user;
  `;
  return current_user;
}
