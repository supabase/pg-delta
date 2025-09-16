import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

/**
 * All properties exposed by CREATE EXTENSION statement are included in diff output.
 * https://www.postgresql.org/docs/current/sql-createextension.html
 *
 * ALTER EXTENSION statement can be generated for changes to the following properties:
 *  - version (limited to available ones), schema (only if relocatable)
 * https://www.postgresql.org/docs/current/sql-alterextension.html
 *
 * Adding or dropping member objects are not supported. For eg. pgmq allows detaching
 * user defined queues by removing its entry from pg_depend. If the detached table
 * lives in an excluded schema like pg_catalog, it will not be diffed.
 *
 * The extension's configuration tables are not diffed.
 *  - extconfig, extcondition
 * https://www.postgresql.org/docs/current/catalog-pg-extension.html
 */
const extensionPropsSchema = z.object({
  name: z.string(),
  schema: z.string(),
  relocatable: z.boolean(),
  version: z.string(),
  owner: z.string(),
  comment: z.string().nullable(),
});

export type ExtensionProps = z.infer<typeof extensionPropsSchema>;

export class Extension extends BasePgModel {
  public readonly name: ExtensionProps["name"];
  public readonly schema: ExtensionProps["schema"];
  public readonly relocatable: ExtensionProps["relocatable"];
  public readonly version: ExtensionProps["version"];
  public readonly owner: ExtensionProps["owner"];
  public readonly comment: ExtensionProps["comment"];

  constructor(props: ExtensionProps) {
    super();

    // Identity fields
    this.name = props.name;

    // Data fields
    this.schema = props.schema;
    this.relocatable = props.relocatable;
    this.version = props.version;
    this.owner = props.owner;
    this.comment = props.comment;
  }

  get stableId(): `extension:${string}` {
    // Extension names are unique per database; schema is relocatable
    return `extension:${this.name}`;
  }

  get identityFields() {
    return {
      name: this.name,
    };
  }

  get dataFields() {
    return {
      schema: this.schema,
      relocatable: this.relocatable,
      version: this.version,
      owner: this.owner,
      comment: this.comment,
    };
  }
}

export async function extractExtensions(sql: Sql): Promise<Extension[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const extensionRows = await sql`
select
  quote_ident(extname) as name,
  extnamespace::regnamespace::text as schema,
  extrelocatable as relocatable,
  extversion as version,
  extowner::regrole::text as owner,
  obj_description(e.oid, 'pg_extension') as comment
from
  pg_catalog.pg_extension e
order by
  1;
  `;
    // Validate and parse each row using the Zod schema
    const validatedRows = extensionRows.map((row: unknown) =>
      extensionPropsSchema.parse(row),
    );
    return validatedRows.map((row: ExtensionProps) => new Extension(row));
  });
}
