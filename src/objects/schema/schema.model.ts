import type { Sql } from "postgres";
import { BasePgModel } from "../base.model.ts";

/**
 * All properties exposed by CREATE SCHEMA statement are included in diff output.
 * https://www.postgresql.org/docs/current/sql-createschema.html
 *
 * ALTER SCHEMA statement can be generated for all properties.
 * https://www.postgresql.org/docs/current/sql-alterschema.html
 */
export interface SchemaProps {
  schema: string;
  owner: string;
}

export class Schema extends BasePgModel {
  public readonly schema: SchemaProps["schema"];
  public readonly owner: SchemaProps["owner"];

  constructor(props: SchemaProps) {
    super();

    // Identity fields
    this.schema = props.schema;

    // Data fields
    this.owner = props.owner;
  }

  get stableId(): `schema:${string}` {
    return `schema:${this.schema}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
    };
  }

  get dataFields() {
    return {
      owner: this.owner,
    };
  }
}

export async function extractSchemas(sql: Sql): Promise<Schema[]> {
  const schemaRows = await sql<SchemaProps[]>`
    with extension_oids as (
      select
        objid
      from
        pg_depend d
      where
        d.refclassid = 'pg_extension'::regclass
        and d.classid = 'pg_namespace'::regclass
    )
    select
      nspname as schema,
      nspowner::regrole as owner
    from
      pg_catalog.pg_namespace
      left outer join extension_oids e on e.objid = oid
      -- <EXCLUDE_INTERNAL>
      where not nspname like any(array['pg\\_%', 'information\\_schema'])
      and e.objid is null
      -- </EXCLUDE_INTERNAL>
    order by
      1;
  `;
  return schemaRows.map((row) => new Schema(row));
}
