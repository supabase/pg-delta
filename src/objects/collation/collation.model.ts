import type { Sql } from "postgres";
import z from "zod";
import { extractVersion } from "../../version.ts";
import { BasePgModel } from "../base.model.ts";

/**
 * Collation provider codes as stored in pg_collation.collprovider
 */
const CollationProviderSchema = z.enum([
  "d", // database default provider (omit PROVIDER clause)
  "b", // builtin
  "c", // libc
  "i", // icu
]);

/**
 * All properties exposed by CREATE COLLATION statement are included in diff output.
 * https://www.postgresql.org/docs/current/sql-createcollation.html
 *
 * ALTER COLLATION statement can only be generated for a subset of properties:
 *  - version, name, owner, schema
 * https://www.postgresql.org/docs/current/sql-altercollation.html
 *
 * Other properties require dropping and creating a new collation.
 */
const collationPropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  provider: CollationProviderSchema,
  is_deterministic: z.boolean(),
  encoding: z.number(),
  collate: z.string(),
  ctype: z.string(),
  locale: z.string().nullable(),
  icu_rules: z.string().nullable(),
  version: z.string().nullable(),
  owner: z.string(),
});

export type CollationProps = z.infer<typeof collationPropsSchema>;

export class Collation extends BasePgModel {
  public readonly schema: CollationProps["schema"];
  public readonly name: CollationProps["name"];
  public readonly provider: CollationProps["provider"];
  public readonly is_deterministic: CollationProps["is_deterministic"];
  public readonly encoding: CollationProps["encoding"];
  public readonly collate: CollationProps["collate"];
  public readonly ctype: CollationProps["ctype"];
  public readonly locale: CollationProps["locale"];
  public readonly icu_rules: CollationProps["icu_rules"];
  public readonly version: CollationProps["version"];
  public readonly owner: CollationProps["owner"];

  constructor(props: CollationProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.provider = props.provider;
    this.is_deterministic = props.is_deterministic;
    this.encoding = props.encoding;
    this.collate = props.collate;
    this.ctype = props.ctype;
    this.locale = props.locale;
    this.icu_rules = props.icu_rules;
    this.version = props.version;
    this.owner = props.owner;
  }

  get stableId(): `collation:${string}` {
    return `collation:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      provider: this.provider,
      is_deterministic: this.is_deterministic,
      encoding: this.encoding,
      collate: this.collate,
      ctype: this.ctype,
      locale: this.locale,
      icu_rules: this.icu_rules,
      version: this.version,
      owner: this.owner,
    };
  }
}

export async function extractCollations(sql: Sql): Promise<Collation[]> {
  const version = await extractVersion(sql);
  const isPostgres17OrGreater = version >= 170000;
  const isPostgres16OrGreater = version >= 160000;
  let collations: any[];
  if (isPostgres17OrGreater) {
    collations = await sql`
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
        regexp_replace(c.collnamespace::regnamespace::text, '^"(.*)"$', '\\1') as schema,
        c.collname as name,
        c.collprovider as provider,
        c.collisdeterministic as is_deterministic,
        c.collencoding as encoding,
        c.collcollate as collate,
        c.collctype as ctype,
        c.colllocale as locale,
        c.collicurules as icu_rules,
        c.collversion as version,
        c.collowner::regrole as owner
      from
        pg_catalog.pg_collation c
        left outer join extension_oids e on c.oid = e.objid
        -- <EXCLUDE_INTERNAL>
        where not c.collnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
        and e.objid is null
        -- </EXCLUDE_INTERNAL>
      order by
        1, 2;
  `;
  } else if (isPostgres16OrGreater) {
    // On postgres 16 there colllocale column was named colliculocale
    collations = await sql`
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
        regexp_replace(c.collnamespace::regnamespace::text, '^"(.*)"$', '\\1') as schema,
        c.collname as name,
        c.collprovider as provider,
        c.collisdeterministic as is_deterministic,
        c.collencoding as encoding,
        c.collcollate as collate,
        c.collctype as ctype,
        colliculocale as locale,
        c.collicurules as icu_rules,
        c.collversion as version,
        c.collowner::regrole as owner
      from
        pg_catalog.pg_collation c
        left outer join extension_oids e on c.oid = e.objid
        -- <EXCLUDE_INTERNAL>
        where not c.collnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
        and e.objid is null
        -- </EXCLUDE_INTERNAL>
      order by
        1, 2;
    `;
  } else {
    // On postgres 15 icu_rules does not exist
    collations = await sql`
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
        regexp_replace(c.collnamespace::regnamespace::text, '^"(.*)"$', '\\1') as schema,
        c.collname as name,
        c.collprovider as provider,
        c.collisdeterministic as is_deterministic,
        c.collencoding as encoding,
        c.collcollate as collate,
        c.collctype as ctype,
        colliculocale as locale,
        null as icu_rules,
        c.collversion as version,
        c.collowner::regrole as owner
      from
        pg_catalog.pg_collation c
        left outer join extension_oids e on c.oid = e.objid
        -- <EXCLUDE_INTERNAL>
        where not c.collnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
        and e.objid is null
        -- </EXCLUDE_INTERNAL>
      order by
        1, 2;
    `;
  }

  // Validate and parse each row using the Zod schema
  const validatedRows = collations.map((row: unknown) =>
    collationPropsSchema.parse(row),
  );
  return validatedRows.map((row: CollationProps) => new Collation(row));
}
