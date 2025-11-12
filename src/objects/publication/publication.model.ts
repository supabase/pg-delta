import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const publicationTablePropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  columns: z.array(z.string()).nullable(),
  row_filter: z.string().nullable(),
});

const publicationPropsSchema = z.object({
  name: z.string(),
  owner: z.string(),
  comment: z.string().nullable(),
  all_tables: z.boolean(),
  publish_insert: z.boolean(),
  publish_update: z.boolean(),
  publish_delete: z.boolean(),
  publish_truncate: z.boolean(),
  publish_via_partition_root: z.boolean(),
  tables: z.array(publicationTablePropsSchema),
  schemas: z.array(z.string()),
});

export type PublicationTableProps = z.infer<typeof publicationTablePropsSchema>;
export type PublicationProps = z.infer<typeof publicationPropsSchema>;

/**
 * Logical replication publication definition extracted from pg_publication.
 *
 * @see https://www.postgresql.org/docs/17/sql-createpublication.html
 */
export class Publication extends BasePgModel {
  public readonly name: PublicationProps["name"];
  public readonly owner: PublicationProps["owner"];
  public readonly comment: PublicationProps["comment"];
  public readonly all_tables: PublicationProps["all_tables"];
  public readonly publish_insert: PublicationProps["publish_insert"];
  public readonly publish_update: PublicationProps["publish_update"];
  public readonly publish_delete: PublicationProps["publish_delete"];
  public readonly publish_truncate: PublicationProps["publish_truncate"];
  public readonly publish_via_partition_root: PublicationProps["publish_via_partition_root"];
  public readonly tables: PublicationTableProps[];
  public readonly schemas: PublicationProps["schemas"];

  constructor(props: PublicationProps) {
    super();

    this.name = props.name;
    this.owner = props.owner;
    this.comment = props.comment;
    this.all_tables = props.all_tables;
    this.publish_insert = props.publish_insert;
    this.publish_update = props.publish_update;
    this.publish_delete = props.publish_delete;
    this.publish_truncate = props.publish_truncate;
    this.publish_via_partition_root = props.publish_via_partition_root;

    const normalizedTables = props.tables.map((table) => ({
      schema: table.schema,
      name: table.name,
      columns: table.columns
        ? [...table.columns].sort((a, b) => a.localeCompare(b))
        : null,
      row_filter: table.row_filter,
    }));

    this.tables = normalizedTables.sort((a, b) => {
      return a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name);
    });

    this.schemas = [...props.schemas].sort((a, b) => a.localeCompare(b));
  }

  get stableId(): `publication:${string}` {
    return `publication:${this.name}`;
  }

  get identityFields() {
    return {
      name: this.name,
    };
  }

  get dataFields() {
    return {
      owner: this.owner,
      comment: this.comment,
      all_tables: this.all_tables,
      publish_insert: this.publish_insert,
      publish_update: this.publish_update,
      publish_delete: this.publish_delete,
      publish_truncate: this.publish_truncate,
      publish_via_partition_root: this.publish_via_partition_root,
      tables: this.tables,
      schemas: this.schemas,
    };
  }
}

/**
 * Extract all logical replication publications from the database.
 */
export async function extractPublications(sql: Sql): Promise<Publication[]> {
  return sql.begin(async (tx) => {
    await tx`set search_path = ''`;
    const rows = await tx`
      with extension_oids as (
        select objid
        from pg_depend d
        where d.refclassid = 'pg_extension'::regclass
          and d.classid = 'pg_publication'::regclass
      ),
      publication_tables as (
        select
          pr.prpubid,
          quote_ident(ns.nspname) as schema,
          quote_ident(cls.relname) as name,
          case
            when pr.prattrs is null then null
            else (
              select json_agg(quote_ident(att.attname) order by cols.ord)
              from unnest(pr.prattrs) with ordinality as cols(attnum, ord)
              join pg_attribute att
                on att.attrelid = pr.prrelid
               and att.attnum = cols.attnum
            )
          end as columns,
          pg_get_expr(pr.prqual, pr.prrelid) as row_filter
        from pg_publication_rel pr
        join pg_class cls on cls.oid = pr.prrelid
        join pg_namespace ns on ns.oid = cls.relnamespace
      ),
      publication_schemas as (
        select
          pn.pnpubid,
          quote_ident(ns.nspname) as schema
        from pg_publication_namespace pn
        join pg_namespace ns on ns.oid = pn.pnnspid
      )
      select
        quote_ident(p.pubname) as name,
        p.pubowner::regrole::text as owner,
        obj_description(p.oid, 'pg_publication') as comment,
        p.puballtables as all_tables,
        p.pubinsert as publish_insert,
        p.pubupdate as publish_update,
        p.pubdelete as publish_delete,
        p.pubtruncate as publish_truncate,
        p.pubviaroot as publish_via_partition_root,
        coalesce(
          (
            select json_agg(
              json_build_object(
                'schema', t.schema,
                'name', t.name,
                'columns', t.columns,
                'row_filter', t.row_filter
              )
              order by t.schema, t.name
            )
            from publication_tables t
            where t.prpubid = p.oid
          ),
          '[]'::json
        ) as tables,
        coalesce(
          (
            select json_agg(s.schema order by s.schema)
            from publication_schemas s
            where s.pnpubid = p.oid
          ),
          '[]'::json
        ) as schemas
      from pg_publication p
      left join extension_oids e on e.objid = p.oid
      where e.objid is null
      order by 1;
    `;

    const validated = rows.map((row) => publicationPropsSchema.parse(row));
    return validated.map((row) => new Publication(row));
  });
}
