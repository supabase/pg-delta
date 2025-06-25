import type { Sql } from "postgres";

/** PostgreSQL relation types */
export type RelationType =
  /** Regular table */
  | "r"
  /** View */
  | "v"
  /** Materialized view */
  | "m"
  /** Composite type */
  | "c"
  /** Partitioned table */
  | "p";

/** PostgreSQL relation persistence types */
export type RelationPersistence =
  /** Permanent relation (default) */
  | "p"
  /** Temporary relation */
  | "t"
  /** Unlogged relation */
  | "u";

/** PostgreSQL identity column types */
export type IdentityType =
  /** not identity */
  | ""
  /** always */
  | "a"
  /** by default */
  | "d";

/** PostgreSQL generated column types */
export type GeneratedType =
  /** not generated */
  | ""
  /** stored */
  | "s";

/** PostgreSQL attribute compression types */
export type CompressionType =
  /** default */
  | ""
  /** pglz */
  | "p"
  /** lz4 */
  | "l"
  /** external */
  | "e";

/** PostgreSQL attribute storage types */
export type StorageType =
  /** plain */
  | "p"
  /** external */
  | "e"
  /** main */
  | "m"
  /** extended */
  | "x";

/** Raw result from PostgreSQL's system catalogs where each row represents a column */
export type RawRelationQueryResult = {
  relationtype: RelationType;
  schema: string;
  name: string;
  definition: string | null;
  position_number: number;
  attname: string;
  not_null: boolean;
  datatype: string;
  identity_type: IdentityType;
  generated: GeneratedType;
  compression: CompressionType;
  storage_type: StorageType;
  is_identity: boolean;
  is_identity_always: boolean;
  collation: string | null;
  defaultdef: string | null;
  oid: number;
  datatypestring: string;
  is_enum: boolean;
  enum_name: string | null;
  enum_schema: string | null;
  comment: string | null;
  parent_table: string | null;
  partition_def: string | null;
  rowsecurity: boolean;
  forcerowsecurity: boolean;
  persistence: RelationPersistence;
  page_size_estimate: number;
  row_count_estimate: number;
  owner: string;
  storage_length: number;
  type_modifier: number | null;
  array_dimensions: number;
  options: string[] | null;
  fdw_options: string[] | null;
  relation_options: string[] | null;
}[];

/** A single column in a relation */
export type RelationColumn = {
  positionNumber: number;
  attName: string;
  notNull: boolean;
  dataType: string;
  identityType: IdentityType;
  generated: GeneratedType;
  compression: CompressionType;
  storageType: StorageType;
  isIdentity: boolean;
  isIdentityAlways: boolean;
  collation: string | null;
  defaultDef: string | null;
  dataTypeString: string;
  isEnum: boolean;
  enumName: string | null;
  enumSchema: string | null;
  storageLength: number;
  typeModifier: number | null;
  arrayDimensions: number;
  options: string[] | null;
  fdwOptions: string[] | null;
};

/** A grouped relation with its columns */
export type GroupedRelation = {
  relationType: RelationType;
  schema: string;
  name: string;
  definition: string | null;
  oid: number;
  comment: string | null;
  parentTable: string | null;
  partitionDef: string | null;
  rowSecurity: boolean;
  forceRowSecurity: boolean;
  persistence: RelationPersistence;
  pageSizeEstimate: number;
  rowCountEstimate: number;
  columns: RelationColumn[];
  owner: string;
  relationOptions: string[] | null;
};

/** Relations grouped by type with their columns nested */
export type InspectedRelations = {
  tables: GroupedRelation[]; // r, p
  views: GroupedRelation[]; // v
  materializedViews: GroupedRelation[]; // m
  compositeTypes: GroupedRelation[]; // c
};

function groupAndCategorizeRelations(
  relations: RawRelationQueryResult,
): InspectedRelations {
  const grouped = new Map<string, GroupedRelation>();
  const categorized: InspectedRelations = {
    tables: [],
    views: [],
    materializedViews: [],
    compositeTypes: [],
  };

  // First group relations by their unique key
  for (const relation of relations) {
    const key = JSON.stringify([
      relation.relationtype,
      relation.schema,
      relation.name,
    ]);

    if (!grouped.has(key)) {
      // Create new relation entry
      const groupedRelation: GroupedRelation = {
        relationType: relation.relationtype,
        schema: relation.schema,
        name: relation.name,
        definition: relation.definition,
        oid: relation.oid,
        comment: relation.comment,
        parentTable: relation.parent_table,
        partitionDef: relation.partition_def,
        rowSecurity: relation.rowsecurity,
        forceRowSecurity: relation.forcerowsecurity,
        persistence: relation.persistence,
        pageSizeEstimate: relation.page_size_estimate,
        rowCountEstimate: relation.row_count_estimate,
        columns: [],
        owner: relation.owner,
        relationOptions: relation.relation_options,
      };

      grouped.set(key, groupedRelation);

      // Categorize the relation immediately
      switch (relation.relationtype) {
        case "r":
        case "p":
          categorized.tables.push(groupedRelation);
          break;
        case "v":
          categorized.views.push(groupedRelation);
          break;
        case "m":
          categorized.materializedViews.push(groupedRelation);
          break;
        case "c":
          categorized.compositeTypes.push(groupedRelation);
          break;
      }
    }

    // Add column information
    // biome-ignore lint/style/noNonNullAssertion: defined because of the grouped.has(key) assertion above
    const relationGroup = grouped.get(key)!;
    relationGroup.columns.push({
      positionNumber: relation.position_number,
      attName: relation.attname,
      notNull: relation.not_null,
      dataType: relation.datatype,
      identityType: relation.identity_type,
      generated: relation.generated,
      compression: relation.compression,
      storageType: relation.storage_type,
      isIdentity: relation.is_identity,
      isIdentityAlways: relation.is_identity_always,
      collation: relation.collation,
      defaultDef: relation.defaultdef,
      dataTypeString: relation.datatypestring,
      isEnum: relation.is_enum,
      enumName: relation.enum_name,
      enumSchema: relation.enum_schema,
      storageLength: relation.storage_length,
      typeModifier: relation.type_modifier,
      arrayDimensions: relation.array_dimensions,
      options: relation.options,
      fdwOptions: relation.fdw_options,
    });
  }

  return categorized;
}

export async function inspectRelations(sql: Sql): Promise<InspectedRelations> {
  const relations = await sql<RawRelationQueryResult>`
    with
      extension_oids as (
        select
          objid
        from
          pg_depend d
        where
          d.refclassid = 'pg_extension'::regclass
          and d.classid = 'pg_class'::regclass
      ),
      enums as (
        select
          t.oid as enum_oid,
          n.nspname as "schema",
          t.typname as name
        from
          pg_catalog.pg_type t
          left join pg_catalog.pg_namespace n on n.oid = t.typnamespace
          left outer join extension_oids e on t.oid = e.objid
        where
          t.typcategory = 'E'
          and e.objid is null
          -- <EXCLUDE_INTERNAL>
          and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
          and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
          -- </EXCLUDE_INTERNAL>
        order by
          1,
          2
      ),
      r as (
        select
          c.relname as name,
          n.nspname as schema,
          c.relkind as relationtype,
          c.oid as oid,
          case
            when c.relkind in ('m', 'v') then pg_get_viewdef(c.oid)
            else null
          end as definition,
          (
            select
              '"' || nmsp_parent.nspname || '"."' || parent.relname || '"' as parent
            from
              pg_inherits
              join pg_class parent on pg_inherits.inhparent = parent.oid
              join pg_class child on pg_inherits.inhrelid = child.oid
              join pg_namespace nmsp_parent on nmsp_parent.oid = parent.relnamespace
              join pg_namespace nmsp_child on nmsp_child.oid = child.relnamespace
            where
              child.oid = c.oid
          ) as parent_table,
          case
            when c.relpartbound is not null then pg_get_expr(c.relpartbound, c.oid, true)
            when c.relhassubclass is not null then pg_catalog.pg_get_partkeydef (c.oid)
          end as partition_def,
          c.relrowsecurity::boolean as rowsecurity,
          c.relforcerowsecurity::boolean as forcerowsecurity,
          c.relpersistence as persistence,
          c.relpages as page_size_estimate,
          c.reltuples as row_count_estimate,
          c.reloptions as relation_options,
          pg_get_userbyid(c.relowner) as owner
        from
          pg_catalog.pg_class c
          inner join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          left outer join extension_oids e on c.oid = e.objid
        where
          c.relkind in ('r', 'v', 'm', 'c', 'p')
          -- <EXCLUDE_INTERNAL>
          and e.objid is null
          and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
          and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
          -- </EXCLUDE_INTERNAL>
      )
    select
      r.relationtype,
      r.schema,
      r.name,
      r.definition as definition,
      a.attnum as position_number,
      a.attname as attname,
      a.attnotnull as not_null,
      a.atttypid::regtype as datatype,
      a.attidentity as identity_type,
      a.attgenerated as generated,
      a.attcompression as compression,
      a.attstorage as storage_type,
      a.attidentity != '' as is_identity,
      a.attidentity = 'a' as is_identity_always,
      (
        select
          c.collname
        from
          pg_catalog.pg_collation c,
          pg_catalog.pg_type t
        where
          c.oid = a.attcollation
          and t.oid = a.atttypid
          and a.attcollation <> t.typcollation
      ) as "collation",
      pg_get_expr(ad.adbin, ad.adrelid) as defaultdef,
      r.oid as oid,
      format_type(atttypid, atttypmod) as datatypestring,
      e.enum_oid is not null as is_enum,
      e.name as enum_name,
      e.schema as enum_schema,
      pg_catalog.obj_description (r.oid) as comment,
      r.parent_table,
      r.partition_def,
      r.rowsecurity,
      r.forcerowsecurity,
      r.persistence,
      r.page_size_estimate,
      r.row_count_estimate,
      r.owner,
      a.attlen as storage_length,
      a.atttypmod as type_modifier,
      a.attndims as array_dimensions,
      a.attoptions as options,
      a.attfdwoptions as fdw_options,
      r.relation_options
    from
      r
      left join pg_catalog.pg_attribute a on r.oid = a.attrelid
      and a.attnum > 0
      left join pg_catalog.pg_attrdef ad on a.attrelid = ad.adrelid
      and a.attnum = ad.adnum
      left join enums e on a.atttypid = e.enum_oid
    where
      a.attisdropped is not true
      -- <EXCLUDE_INTERNAL>
      and r.schema not in ('pg_catalog', 'information_schema', 'pg_toast')
      and r.schema not like 'pg_temp_%' and r.schema not like 'pg_toast_temp_%'
      -- </EXCLUDE_INTERNAL>
    order by
      relationtype,
      r.schema,
      r.name,
      position_number;
  `;

  return groupAndCategorizeRelations(relations);
}
