import type { Sql } from "postgres";
import { BasePgModel } from "./base.ts";

interface ExtensionProps {
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
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.relocatable = props.relocatable;
    this.version = props.version;
    this.owner = props.owner;
  }

  get stableId(): `extension:${string}` {
    return `extension:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
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
