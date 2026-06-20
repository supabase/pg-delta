/**
 * OpenAPI producer: PostgREST OpenAPI document -> `GeneratorMetadata`.
 *
 * Second producer for the pluggable `GeneratorMetadata` contract, alongside
 * `introspect(db)`. It reads the `x-postgrest-typegen-metadata` vendor extension
 * that PostgREST emits under its opt-in `openapi-metadata` config and maps it to
 * `GeneratorMetadata`, so the language generators can run from a PostgREST URL
 * alone (no database connection).
 *
 * The block is name-keyed; OIDs are synthesized here (memoized by name) so the
 * join keys the generators rely on (`table_id`, `type_id`,
 * `return_type_relation_id`) stay consistent. See {@link PostgrestTypegenMetadata}
 * for the contract and field conventions.
 */
import type {
  GeneratorMetadata,
  PostgresColumn,
  PostgresFunction,
  PostgresRelationship,
  PostgresType,
} from "../types.ts";
import {
  METADATA_EXTENSION_KEY,
  type MetadataTable,
  type OpenApiDocumentWithMetadata,
  type PostgrestTypegenMetadata,
} from "./types.ts";

export type {
  MetadataColumn,
  MetadataComposite,
  MetadataEnum,
  MetadataFunction,
  MetadataRelationship,
  MetadataTable,
  OpenApiDocumentWithMetadata,
  PostgrestTypegenMetadata,
} from "./types.ts";
export { METADATA_EXTENSION_KEY } from "./types.ts";

const KIND_TO_BUCKET = {
  table: "tables",
  foreign_table: "foreignTables",
  view: "views",
  materialized_view: "materializedViews",
} as const;

/**
 * Real pg_catalog OIDs for common base/array types. The generator compares arg
 * `type_id`s against a hardcoded OID set and sorts overloads by `type_id`, so
 * these must be the genuine OIDs; user types (enums/composites/table rows) fall
 * back to synthesized ids, which is fine since they're never in that set.
 */
const BASE_TYPE_OIDS: Record<string, number> = {
  bool: 16,
  bytea: 17,
  char: 18,
  name: 19,
  int8: 20,
  int2: 21,
  int4: 23,
  text: 25,
  oid: 26,
  json: 114,
  xml: 142,
  point: 600,
  float4: 700,
  float8: 701,
  bpchar: 1042,
  varchar: 1043,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  interval: 1186,
  timetz: 1266,
  numeric: 1700,
  uuid: 2950,
  jsonb: 3802,
  record: 2249,
  void: 2278,
  // common array types
  _bool: 1000,
  _bytea: 1001,
  _int8: 1016,
  _int2: 1005,
  _int4: 1007,
  _text: 1009,
  _varchar: 1015,
  _numeric: 1231,
  _uuid: 2951,
  _json: 199,
  _jsonb: 3807,
  _timestamptz: 1185,
  _timestamp: 1115,
  _date: 1182,
  _float4: 1021,
  _float8: 1022,
};

/**
 * Extract and map the `x-postgrest-typegen-metadata` block of a PostgREST
 * OpenAPI document into `GeneratorMetadata`.
 *
 * @throws if the block is absent (PostgREST without `openapi-metadata` enabled,
 *   or a non-PostgREST document).
 */
export function openApiToGeneratorMetadata(
  doc: OpenApiDocumentWithMetadata,
): GeneratorMetadata {
  const block = doc[METADATA_EXTENSION_KEY];
  if (!block) {
    throw new Error(
      `OpenAPI document has no "${METADATA_EXTENSION_KEY}" extension. ` +
        "Enable PostgREST's `openapi-metadata` config to emit it.",
    );
  }
  return metadataToGeneratorMetadata(block);
}

/** Map an already-extracted metadata block to `GeneratorMetadata`. */
export function metadataToGeneratorMetadata(
  block: PostgrestTypegenMetadata,
): GeneratorMetadata {
  // ---- OID synthesis (memoized by stable key) --------------------------------
  let nextOid = 16384;
  const oidByKey = new Map<string, number>();
  const oid = (key: string): number => {
    const existing = oidByKey.get(key);
    if (existing !== undefined) return existing;
    const id = nextOid++;
    oidByKey.set(key, id);
    return id;
  };
  const relationId = (schema: string, name: string) =>
    oid(`rel:${schema}.${name}`);

  // ---- type registry ---------------------------------------------------------
  // Every type referenced by a column/arg/return needs an entry so the
  // generator's `typesById.get(type_id)` resolves and `pgTypeToTsType` can run.
  const types: PostgresType[] = [];
  const typeByName = new Map<string, PostgresType>();
  const ensureType = (
    name: string,
    opts: {
      schema?: string;
      enums?: string[];
      attributes?: { name: string; type_id: number }[];
      typeRelationId?: number | null;
    } = {},
  ): number => {
    const existing = typeByName.get(name);
    if (existing) {
      if (opts.enums && existing.enums.length === 0)
        existing.enums = opts.enums;
      if (opts.attributes && existing.attributes.length === 0)
        existing.attributes = opts.attributes;
      if (opts.typeRelationId != null && existing.type_relation_id == null)
        existing.type_relation_id = opts.typeRelationId;
      return existing.id;
    }
    const t: PostgresType = {
      // Use real pg_catalog OIDs for known base types: the generator checks arg
      // types against a hardcoded OID set (VALID_UNNAMED_FUNCTION_ARG_TYPES) and
      // sorts overloads by type_id, so synthesized ids would break both.
      id: BASE_TYPE_OIDS[name] ?? oid(`type:${name}`),
      name,
      schema: opts.schema ?? "",
      format: name,
      enums: opts.enums ?? [],
      attributes: opts.attributes ?? [],
      comment: null,
      type_relation_id: opts.typeRelationId ?? null,
    };
    typeByName.set(name, t);
    types.push(t);
    return t.id;
  };

  // Enums first (so enum-typed columns/args resolve to the Enums block).
  for (const e of block.enums) {
    ensureType(e.name, { schema: e.schema, enums: e.values });
  }
  // Table/view row types carry `type_relation_id` (no attributes -> not listed
  // as composites) so single-table-arg functions resolve as relation types.
  for (const t of block.tables) {
    ensureType(t.name, {
      schema: t.schema,
      typeRelationId: relationId(t.schema, t.name),
    });
  }
  // Standalone composite types: attributes -> CompositeTypes block, and a
  // synthesized `type_relation_id` so they count as relation types (needed for
  // SetofOptions on functions returning the composite).
  for (const c of block.composites) {
    ensureType(c.name, {
      schema: c.schema,
      typeRelationId: oid(`comprel:${c.schema}.${c.name}`),
      attributes: c.attributes.map((a) => ({
        name: a.name,
        type_id: ensureType(a.type),
      })),
    });
  }

  // ---- tables / views / matviews / foreign tables + columns ------------------
  const tables: GeneratorMetadata["tables"] = [];
  const foreignTables: GeneratorMetadata["foreignTables"] = [];
  const views: GeneratorMetadata["views"] = [];
  const materializedViews: GeneratorMetadata["materializedViews"] = [];
  const columns: PostgresColumn[] = [];

  const pushTableLike = (t: MetadataTable) => {
    const id = relationId(t.schema, t.name);
    const bucket = KIND_TO_BUCKET[t.kind];

    t.columns.forEach((col, idx) => {
      const ordinal = idx + 1;
      columns.push({
        table_id: id,
        schema: t.schema,
        table: t.name,
        id: `${id}.${ordinal}`,
        ordinal_position: ordinal,
        name: col.name,
        default_value: col.default_value ?? null,
        data_type: col.data_type ?? col.format,
        format: col.format,
        is_identity: col.is_identity,
        identity_generation: col.identity_generation ?? null,
        is_generated: col.is_generated,
        is_nullable: col.is_nullable,
        is_updatable: col.is_updatable,
        is_unique: col.is_unique ?? false,
        enums: col.enums ?? [],
        check: col.check ?? null,
        comment: col.comment ?? null,
      });
    });

    if (bucket === "tables") {
      tables.push({
        id,
        schema: t.schema,
        name: t.name,
        rls_enabled: false,
        rls_forced: false,
        replica_identity: "DEFAULT",
        bytes: 0,
        size: "0 bytes",
        live_rows_estimate: 0,
        dead_rows_estimate: 0,
        comment: t.comment ?? null,
      });
    } else if (bucket === "foreignTables") {
      foreignTables.push({
        id,
        schema: t.schema,
        name: t.name,
        comment: t.comment ?? null,
      });
    } else if (bucket === "views") {
      views.push({
        id,
        schema: t.schema,
        name: t.name,
        is_updatable: t.updatable,
        comment: t.comment ?? null,
      });
    } else {
      materializedViews.push({
        id,
        schema: t.schema,
        name: t.name,
        is_populated: t.is_populated ?? true,
        comment: t.comment ?? null,
      });
    }
  };
  for (const t of block.tables) pushTableLike(t);

  // ---- relationships ---------------------------------------------------------
  const relationships: PostgresRelationship[] = block.relationships.map(
    (r) => ({
      foreign_key_name: r.constraint_name,
      schema: r.schema,
      relation: r.relation,
      columns: r.columns,
      is_one_to_one: r.is_one_to_one,
      referenced_schema: r.referenced_schema,
      referenced_relation: r.referenced_relation,
      referenced_columns: r.referenced_columns,
    }),
  );

  // ---- functions (RPC + computed scalar/array fields) ------------------------
  const functions: PostgresFunction[] = block.functions.map((fn) => {
    const args = fn.args.map((a) => ({
      mode: a.mode,
      name: a.name,
      type_id: ensureType(a.type),
      has_default: a.has_default,
    }));
    const returnTypeId = ensureType(fn.return.type);
    return {
      id: oid(`fn:${fn.schema}.${fn.name}.${fn.argument_types}`),
      schema: fn.schema,
      name: fn.name,
      language: fn.language ?? "sql",
      definition: "",
      complete_statement: "",
      args,
      argument_types: fn.argument_types,
      identity_argument_types: fn.argument_types,
      return_type_id: returnTypeId,
      return_type: fn.return.type,
      return_type_relation_id: fn.return.relation
        ? relationId(fn.return.relation.schema, fn.return.relation.name)
        : null,
      is_set_returning_function: fn.return.is_set,
      prorows: fn.return.rows ?? null,
      behavior: fn.volatility,
      security_definer: false,
      config_params: null,
    } satisfies PostgresFunction;
  });

  return {
    schemas: block.schemas.map((s) => ({
      id: oid(`schema:${s.name}`),
      name: s.name,
      owner: s.owner ?? "postgres",
    })),
    tables,
    foreignTables,
    views,
    materializedViews,
    columns,
    relationships,
    functions,
    types,
  };
}
