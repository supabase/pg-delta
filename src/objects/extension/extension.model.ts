import type { Sql } from "postgres";
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
export interface ExtensionProps {
  name: string;
  schema: string;
  relocatable: boolean;
  version: string;
  owner: string;
}

export class Extension extends BasePgModel {
  public readonly name: ExtensionProps["name"];
  public readonly schema: ExtensionProps["schema"];
  public readonly relocatable: ExtensionProps["relocatable"];
  public readonly version: ExtensionProps["version"];
  public readonly owner: ExtensionProps["owner"];

  constructor(props: ExtensionProps) {
    super();

    // Identity fields
    this.name = props.name;

    // Data fields
    this.schema = props.schema;
    this.relocatable = props.relocatable;
    this.version = props.version;
    this.owner = props.owner;
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
    };
  }
}

export async function extractExtensions(sql: Sql): Promise<Extension[]> {
  const extensionRows = await sql<ExtensionProps[]>`
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
  return extensionRows.map((row) => new Extension(row));
}
