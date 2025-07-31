import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

// All properties exposed by CREATE LANGUAGE statement are included in diff output.
// https://www.postgresql.org/docs/current/sql-createlanguage.html
//
// ALTER LANGUAGE statement can only be used to rename the language or change the owner.
// https://www.postgresql.org/docs/current/sql-alterlanguage.html
//
// Other properties require dropping and creating a new language.
interface InspectedLanguageRow {
  name: string;
  is_trusted: boolean;
  is_procedural: boolean;
  call_handler: string | null;
  inline_handler: string | null;
  validator: string | null;
  owner: string;
  // TODO: support acl types ?
}

export type InspectedLanguage = InspectedLanguageRow & DependentDatabaseObject;

function identifyLanguage(language: InspectedLanguageRow): string {
  return language.name;
}

export async function inspectLanguages(
  sql: Sql,
): Promise<Map<string, InspectedLanguage>> {
  const languages = await sql<InspectedLanguageRow[]>`
    with extension_oids as (
      select
        objid
      from
        pg_depend d
      where
        d.refclassid = 'pg_extension'::regclass
        and d.classid = 'pg_language'::regclass
    )
    select
      lan.lanname as name,
      lan.lanpltrusted as is_trusted,
      lan.lanispl as is_procedural,
      lan.lanplcallfoid::regprocedure as call_handler,
      lan.laninline::regprocedure as inline_handler,
      lan.lanvalidator::regprocedure as validator,
      lan.lanowner::regrole as owner
    from
      pg_catalog.pg_language lan
      left outer join extension_oids e on lan.oid = e.objid
      -- <EXCLUDE_INTERNAL and default>
      where lan.lanname not in ('internal', 'c')
    order by
      lan.lanname;
  `;

  return new Map(
    languages.map((l) => [
      identifyLanguage(l),
      {
        ...l,
        call_handler: l.call_handler === "-" ? null : l.call_handler,
        inline_handler: l.inline_handler === "-" ? null : l.inline_handler,
        validator: l.validator === "-" ? null : l.validator,
        dependent_on: [],
        dependents: [],
      },
    ]),
  );
}
