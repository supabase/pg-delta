import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";
import { stableId } from "../utils.ts";

const RuleEventSchema = z.enum(["SELECT", "INSERT", "UPDATE", "DELETE"]);
const RuleEnabledStateSchema = z.enum(["O", "D", "R", "A"]);

const RuleRelationKindSchema = z.enum([
  "r", // ordinary table
  "p", // partitioned table
  "f", // foreign table
  "v", // view
  "m", // materialized view
]);

const rulePropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  table_name: z.string(),
  relation_kind: RuleRelationKindSchema,
  event: RuleEventSchema,
  enabled: RuleEnabledStateSchema,
  is_instead: z.boolean(),
  owner: z.string(),
  definition: z.string(),
  comment: z.string().nullable(),
  columns: z.array(z.string()),
});

export type RuleEnabledState = z.infer<typeof RuleEnabledStateSchema>;
export type RuleProps = z.infer<typeof rulePropsSchema>;

export class Rule extends BasePgModel {
  public readonly schema: RuleProps["schema"];
  public readonly name: RuleProps["name"];
  public readonly table_name: RuleProps["table_name"];
  public readonly relation_kind: RuleProps["relation_kind"];
  public readonly event: RuleProps["event"];
  public readonly enabled: RuleProps["enabled"];
  public readonly is_instead: RuleProps["is_instead"];
  public readonly owner: RuleProps["owner"];
  public readonly definition: RuleProps["definition"];
  public readonly comment: RuleProps["comment"];
  public readonly columns: RuleProps["columns"];

  constructor(props: RuleProps) {
    super();

    this.schema = props.schema;
    this.name = props.name;
    this.table_name = props.table_name;
    this.relation_kind = props.relation_kind;
    this.event = props.event;
    this.enabled = props.enabled;
    this.is_instead = props.is_instead;
    this.owner = props.owner;
    this.definition = props.definition;
    this.comment = props.comment;
    this.columns = props.columns;
  }

  get stableId(): `rule:${string}` {
    return `rule:${this.schema}.${this.table_name}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
      table_name: this.table_name,
    };
  }

  get dataFields() {
    return {
      event: this.event,
      enabled: this.enabled,
      is_instead: this.is_instead,
      owner: this.owner,
      definition: this.definition,
      comment: this.comment,
      columns: this.columns,
    };
  }

  get relationStableId(): string {
    switch (this.relation_kind) {
      case "v":
        return stableId.view(this.schema, this.table_name);
      case "m":
        return stableId.materializedView(this.schema, this.table_name);
      default:
        return stableId.table(this.schema, this.table_name);
    }
  }
}

export async function extractRules(sql: Sql): Promise<Rule[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const ruleRows = await sql`
      WITH extension_oids AS (
        SELECT
          objid
        FROM
          pg_depend d
        WHERE
          d.refclassid = 'pg_extension'::regclass
          AND d.classid = 'pg_rewrite'::regclass
      )
      SELECT
        c.relnamespace::regnamespace::text AS schema,
        quote_ident(r.rulename) AS name,
        quote_ident(c.relname) AS table_name,
        c.relkind AS relation_kind,
        CASE r.ev_type
          WHEN '1' THEN 'SELECT'
          WHEN '2' THEN 'UPDATE'
          WHEN '3' THEN 'INSERT'
          WHEN '4' THEN 'DELETE'
          ELSE NULL
        END AS event,
        r.ev_enabled AS enabled,
        r.is_instead,
        c.relowner::regrole::text AS owner,
        pg_get_ruledef(r.oid, true) AS definition,
        obj_description(r.oid, 'pg_rewrite') AS comment,
        COALESCE(
          (
            SELECT json_agg(quote_ident(att.attname) ORDER BY dep.refobjsubid)
            FROM pg_depend dep
            JOIN pg_attribute att
              ON att.attrelid = dep.refobjid
             AND att.attnum = dep.refobjsubid
             AND att.attnum > 0
             AND NOT att.attisdropped
            WHERE dep.classid = 'pg_rewrite'::regclass
              AND dep.objid = r.oid
              AND dep.refclassid = 'pg_class'::regclass
              AND dep.refobjid = c.oid
              AND dep.refobjsubid > 0
          ), '[]'
        ) AS columns
      FROM
        pg_catalog.pg_rewrite r
        JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
        LEFT JOIN extension_oids e ON r.oid = e.objid
      WHERE
        NOT c.relnamespace::regnamespace::text LIKE ANY (ARRAY['pg\\_%', 'information\\_schema'])
        AND e.objid IS NULL
        AND r.rulename <> '_RETURN'
      ORDER BY
        1, 3, 2;
    `;

    const validatedRows = ruleRows.map((row: unknown) =>
      rulePropsSchema.parse(row),
    );

    return validatedRows.map((row) => new Rule(row));
  });
}
