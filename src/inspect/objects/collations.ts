import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";
import { inspectVersion } from "./version.ts";

// PostgreSQL collation provider types
export type CollationProvider =
  /** default */
  | "d"
  /** libc */
  | "c"
  /** icu */
  | "i";

export interface InspectedCollationRow {
  schema: string;
  name: string;
  provider: CollationProvider;
  is_deterministic: boolean;
  encoding: number;
  collate: string;
  ctype: string;
  locale: string | null;
  icu_rules: string | null;
  version: string | null;
  owner: string;
}

export type InspectedCollation = InspectedCollationRow &
  DependentDatabaseObject;

export function identifyCollation(collation: InspectedCollationRow): string {
  return `${collation.schema}.${collation.name}`;
}

export async function inspectCollations(
  sql: Sql,
): Promise<Map<string, InspectedCollation>> {
  const version = await inspectVersion(sql);
  const isPostgres17OrGreater = version.version >= 170000;
  const isPostgres16OrGreater = version.version >= 160000;
  let collations: InspectedCollationRow[];
  if (isPostgres17OrGreater) {
    collations = await sql<InspectedCollationRow[]>`
      with extension_oids as (
        select
          objid
        from
          pg_depend d
        where
          d.refclassid = 'pg_extension'::regclass
          and d.classid = 'pg_collation'::regclass
      )
      select
        n.nspname as schema,
        c.collname as name,
        c.collprovider as provider,
        c.collisdeterministic as is_deterministic,
        c.collencoding as encoding,
        c.collcollate as collate,
        c.collctype as ctype,
        c.colllocale as locale,
        c.collicurules as icu_rules,
        c.collversion as version,
        pg_get_userbyid(c.collowner) as owner
      from
        pg_catalog.pg_collation c
        inner join pg_catalog.pg_namespace n on n.oid = c.collnamespace
        left outer join extension_oids e on c.oid = e.objid
        -- <EXCLUDE_INTERNAL>
        where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
        and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
        and e.objid is null
        -- </EXCLUDE_INTERNAL>
      order by
        1, 2;
  `;
  } else if (isPostgres16OrGreater) {
    // On postgres 16 there colllocale column was named colliculocale
    collations = await sql<InspectedCollationRow[]>`
      with extension_oids as (
        select
          objid
        from
          pg_depend d
        where
          d.refclassid = 'pg_extension'::regclass
          and d.classid = 'pg_collation'::regclass
      )
      select
        n.nspname as schema,
        c.collname as name,
        c.collprovider as provider,
        c.collisdeterministic as is_deterministic,
        c.collencoding as encoding,
        c.collcollate as collate,
        c.collctype as ctype,
        colliculocale as locale,
        c.collicurules as icu_rules,
        c.collversion as version,
        pg_get_userbyid(c.collowner) as owner
      from
        pg_catalog.pg_collation c
        inner join pg_catalog.pg_namespace n on n.oid = c.collnamespace
        left outer join extension_oids e on c.oid = e.objid
        -- <EXCLUDE_INTERNAL>
        where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
        and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
        and e.objid is null
        -- </EXCLUDE_INTERNAL>
      order by
        1, 2;
    `;
  } else {
    // On postgres 15 icu_rules does not exist
    collations = await sql<InspectedCollationRow[]>`
      with extension_oids as (
        select
          objid
        from
          pg_depend d
        where
          d.refclassid = 'pg_extension'::regclass
          and d.classid = 'pg_collation'::regclass
      )
      select
        n.nspname as schema,
        c.collname as name,
        c.collprovider as provider,
        c.collisdeterministic as is_deterministic,
        c.collencoding as encoding,
        c.collcollate as collate,
        c.collctype as ctype,
        colliculocale as locale,
        null as icu_rules,
        c.collversion as version,
        pg_get_userbyid(c.collowner) as owner
      from
        pg_catalog.pg_collation c
        inner join pg_catalog.pg_namespace n on n.oid = c.collnamespace
        left outer join extension_oids e on c.oid = e.objid
        -- <EXCLUDE_INTERNAL>
        where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
        and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
        and e.objid is null
        -- </EXCLUDE_INTERNAL>
      order by
        1, 2;
    `;
  }

  return new Map(
    collations.map((c) => [
      identifyCollation(c),
      {
        ...c,
        dependent_on: [],
        dependents: [],
      },
    ]),
  );
}
