import type { Sql } from "postgres";
import { BasePgModel } from "../base.model.ts";

/**
 * All properties exposed by CREATE LANGUAGE statement are included in diff output.
 * https://www.postgresql.org/docs/current/sql-createlanguage.html
 *
 * ALTER LANGUAGE statement can only be used to rename the language or change the owner.
 * https://www.postgresql.org/docs/current/sql-alterlanguage.html
 *
 * Other properties require dropping and creating a new language.
 */
interface LanguageProps {
  name: string;
  is_trusted: boolean;
  is_procedural: boolean;
  call_handler: string | null;
  inline_handler: string | null;
  validator: string | null;
  owner: string;
}

export class Language extends BasePgModel {
  public readonly name: LanguageProps["name"];
  public readonly is_trusted: LanguageProps["is_trusted"];
  public readonly is_procedural: LanguageProps["is_procedural"];
  public readonly call_handler: LanguageProps["call_handler"];
  public readonly inline_handler: LanguageProps["inline_handler"];
  public readonly validator: LanguageProps["validator"];
  public readonly owner: LanguageProps["owner"];

  constructor(props: LanguageProps) {
    super();

    // Identity fields
    this.name = props.name;

    // Data fields
    this.is_trusted = props.is_trusted;
    this.is_procedural = props.is_procedural;
    this.call_handler = props.call_handler;
    this.inline_handler = props.inline_handler;
    this.validator = props.validator;
    this.owner = props.owner;
  }

  get stableId(): `language:${string}` {
    return `language:${this.name}`;
  }

  get identityFields() {
    return {
      name: this.name,
    };
  }

  get dataFields() {
    return {
      is_trusted: this.is_trusted,
      is_procedural: this.is_procedural,
      call_handler: this.call_handler,
      inline_handler: this.inline_handler,
      validator: this.validator,
      owner: this.owner,
    };
  }
}

export async function extractLanguages(sql: Sql): Promise<Language[]> {
  const languageRows = await sql<LanguageProps[]>`
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

  return languageRows.map(
    (row) =>
      new Language({
        ...row,
        call_handler: row.call_handler === "-" ? null : row.call_handler,
        inline_handler: row.inline_handler === "-" ? null : row.inline_handler,
        validator: row.validator === "-" ? null : row.validator,
      }),
  );
}
