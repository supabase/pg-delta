/**
 * SPIKE adapter: PostgREST OpenAPI (Swagger 2.0) -> GeneratorMetadata.
 *
 * Throwaway, experimental code. NOT wired into the package build/exports and
 * deliberately spike-quality. Its only job is to let the harness in `run.ts`
 * feed `generateTypescript` from an OpenAPI document so we can diff the result
 * against the live-DB `introspect()` path and quantify the fidelity gaps.
 *
 * Known, intentional approximations are flagged inline with `GAP:` comments and
 * summarized in REPORT.md.
 */
import type {
  GeneratorMetadata,
  PostgresColumn,
  PostgresFunction,
  PostgresRelationship,
  PostgresType,
} from "../../src/types.ts";

// ---------------------------------------------------------------------------
// Minimal Swagger 2.0 shape (only the bits PostgREST emits that we consume).
// ---------------------------------------------------------------------------
interface OpenApiProperty {
  type?: string;
  format?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  items?: OpenApiProperty;
  maxLength?: number;
}
interface OpenApiDefinition {
  type?: string;
  required?: string[];
  properties?: Record<string, OpenApiProperty>;
  description?: string;
}
interface OpenApiBodyParameter {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: {
    $ref?: string;
    properties?: Record<string, OpenApiProperty>;
    required?: string[];
  };
  type?: string;
  format?: string;
}
interface OpenApiOperation {
  parameters?: OpenApiBodyParameter[];
  description?: string;
  summary?: string;
  tags?: string[];
}
interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
}
export interface OpenApiDocument {
  swagger?: string;
  info?: { title?: string; description?: string; version?: string };
  definitions?: Record<string, OpenApiDefinition>;
  paths?: Record<string, OpenApiPathItem>;
  parameters?: Record<string, OpenApiBodyParameter>;
}

const DEFAULT_SCHEMA = "public";

/**
 * Map PostgREST's `format` (full SQL type names) to the pg_catalog SHORT names
 * that the TypeScript generator's `pgTypeToTsType` understands.
 *
 * GAP: postgres-meta carries the catalog short name (`int8`, `timestamptz`, …)
 * directly. PostgREST exposes the human SQL spelling (`bigint`, `timestamp with
 * time zone`, …). Anything not in this table falls through unmapped and the
 * generator renders it as `unknown` (or as an enum/composite name if it matches
 * a synthesized type).
 */
const SQL_TYPE_TO_PG_FORMAT: Record<string, string> = {
  // PostgREST emits OpenAPI numeric `format`s for integers/floats …
  int64: "int8",
  int32: "int4",
  int16: "int2",
  double: "float8",
  float: "float4",
  // … and the raw SQL spelling for everything else.
  bigint: "int8",
  integer: "int4",
  smallint: "int2",
  "double precision": "float8",
  real: "float4",
  numeric: "numeric",
  boolean: "bool",
  text: "text",
  "character varying": "varchar",
  character: "bpchar",
  uuid: "uuid",
  json: "json",
  jsonb: "jsonb",
  date: "date",
  "timestamp without time zone": "timestamp",
  "timestamp with time zone": "timestamptz",
  "time without time zone": "time",
  "time with time zone": "timetz",
  bytea: "bytea",
  interval: "interval",
};

/** Synthesizes monotonic OIDs, memoized by key so joins stay consistent. */
function makeOidFactory() {
  let next = 16384; // mimic the userland OID range
  const byKey = new Map<string, number>();
  return (key: string): number => {
    const existing = byKey.get(key);
    if (existing !== undefined) return existing;
    const id = next++;
    byKey.set(key, id);
    return id;
  };
}

/** Strip a leading `public.` (or any schema) qualifier from a type name. */
function bareTypeName(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(dot + 1);
}

/**
 * Translate an OpenAPI property's `format`/`type` into the generator's
 * `column.format` short name. Returns the bare enum/composite name untouched
 * (so `pgTypeToTsType` can resolve it against a synthesized type), otherwise the
 * pg_catalog short name, otherwise the raw string (-> `unknown` downstream).
 */
function toColumnFormat(prop: OpenApiProperty): string {
  const raw = prop.format ?? prop.type ?? "unknown";
  // Array column: PostgREST puts the element type on the property `format`
  // (e.g. `text[]`); the `items` schema only carries the JSON `type`, no
  // pg format. Prefer the `format` spelling, fall back to `items`.
  if (raw.endsWith("[]")) {
    const el = raw.slice(0, -2);
    return `_${SQL_TYPE_TO_PG_FORMAT[el] ?? bareTypeName(el)}`;
  }
  if (prop.type === "array" && prop.items) {
    return `_${toColumnFormat(prop.items)}`;
  }
  if (raw in SQL_TYPE_TO_PG_FORMAT) return SQL_TYPE_TO_PG_FORMAT[raw];
  // User-defined type (enum/composite/table-row): keep the bare name so the
  // generator can match it against a synthesized type / table / view.
  return bareTypeName(raw);
}

interface ParsedDescription {
  comment: string | null;
  isPrimaryKey: boolean;
  fk: { table: string; column: string } | null;
}

/** Pull the comment, `<pk/>`, and `<fk .../>` markers out of a description. */
function parseDescription(description: string | undefined): ParsedDescription {
  const desc = description ?? "";
  const isPrimaryKey = /<pk\/>/.test(desc);
  const fkMatch = desc.match(/<fk\s+table='([^']+)'\s+column='([^']+)'\s*\/>/);
  // Everything before the "Note:" block is the user comment.
  let comment: string | null = desc.split(/\n*Note:/)[0] ?? "";
  comment = comment.replace(/<[^>]+>/g, "").trim();
  if (comment === "") comment = null;
  return {
    comment,
    isPrimaryKey,
    fk: fkMatch ? { table: fkMatch[1], column: fkMatch[2] } : null,
  };
}

export function openApiToGeneratorMetadata(
  doc: OpenApiDocument,
): GeneratorMetadata {
  const oid = makeOidFactory();
  const schemaId = oid("schema:public");

  const tables: GeneratorMetadata["tables"] = [];
  const columns: PostgresColumn[] = [];
  const relationships: PostgresRelationship[] = [];
  const types: PostgresType[] = [];
  const functions: PostgresFunction[] = [];

  // A single registry for synthesized types, keyed by (bare) name. Base types
  // (`int8`, `text`, `interval`) don't strictly need an entry — `pgTypeToTsType`
  // resolves them by name string — but the generator only *calls* it for an arg
  // when `typesById.get(arg.type_id)` resolves, so every referenced type needs a
  // row here. Enum entries additionally carry `enums` so they classify as enums.
  const typesByName = new Map<string, PostgresType>();
  function ensureType(name: string, enums?: string[]): number {
    const existing = typesByName.get(name);
    if (existing) {
      if (enums && existing.enums.length === 0) existing.enums = enums;
      return existing.id;
    }
    const t: PostgresType = {
      id: oid(`type:${name}`),
      name,
      schema: DEFAULT_SCHEMA,
      format: name,
      enums: enums ?? [],
      attributes: [],
      comment: null,
      type_relation_id: null,
    };
    typesByName.set(name, t);
    types.push(t);
    return t.id;
  }

  const definitions = doc.definitions ?? {};

  // -------------------------------------------------------------------------
  // definitions -> tables + columns
  //
  // GAP (object-kind classification): PostgREST's OpenAPI does not distinguish
  // tables / views / materialized views / foreign tables — they are all just
  // `definitions`. Everything therefore lands in `tables`; `views`,
  // `materializedViews` and `foreignTables` stay empty.
  // -------------------------------------------------------------------------
  for (const [relName, def] of Object.entries(definitions)) {
    const tableId = oid(`rel:${relName}`);
    const required = new Set(def.required ?? []);
    const primaryKeys: GeneratorMetadata["tables"][number]["primary_keys"] = [];

    tables.push({
      id: tableId,
      schema: DEFAULT_SCHEMA,
      name: relName,
      rls_enabled: false, // GAP: not in OpenAPI
      rls_forced: false, // GAP
      replica_identity: "DEFAULT", // GAP
      bytes: 0, // GAP
      size: "0 bytes", // GAP
      live_rows_estimate: 0, // GAP
      dead_rows_estimate: 0, // GAP
      comment: parseDescription(def.description).comment,
      primary_keys: primaryKeys,
      relationships: [], // legacy shape; generator reads the top-level relationships
    });

    const props = def.properties ?? {};
    let ordinal = 0;
    for (const [colName, prop] of Object.entries(props)) {
      ordinal += 1;
      const parsed = parseDescription(prop.description);
      const format = toColumnFormat(prop);

      // Enum column -> register a matching type so pgTypeToTsType resolves it.
      if (prop.enum && prop.enum.length > 0) {
        ensureType(bareTypeName(prop.format ?? format), prop.enum);
      }

      columns.push({
        table_id: tableId,
        schema: DEFAULT_SCHEMA,
        table: relName,
        id: `${tableId}.${ordinal}`,
        ordinal_position: ordinal,
        name: colName,
        // GAP: PostgREST has no notion of a column default value at all in
        // OpenAPI beyond presence in `required`; `default` is only emitted for
        // some types. Use it when present, else null.
        default_value: prop.default ?? null,
        data_type: prop.format ?? prop.type ?? "unknown",
        format,
        is_identity: false, // GAP: unavailable
        identity_generation: null, // GAP: unavailable -> can't emit `?: never`
        is_generated: false, // GAP: unavailable
        // CENTRAL GAP (nullability): OpenAPI `required` == NOT NULL *and* no
        // default. We can only approximate "nullable" as "not required", which
        // wrongly marks NOT-NULL-with-default columns (identity PKs, defaulted
        // columns) as nullable.
        is_nullable: !required.has(colName),
        is_updatable: true, // GAP: assumed
        is_unique: false, // GAP: unavailable (and FK-drop quirk, see below)
        enums: prop.enum && prop.enum.length > 0 ? prop.enum : [],
        check: null, // GAP
        comment: parsed.comment,
      });

      if (parsed.isPrimaryKey) {
        primaryKeys.push({
          schema: DEFAULT_SCHEMA,
          table_name: relName,
          name: colName,
          table_id: tableId,
        });
      }

      if (parsed.fk) {
        relationships.push({
          // GAP: real constraint name is unavailable; synthesize a plausible one.
          foreign_key_name: `${relName}_${colName}_fkey`,
          schema: DEFAULT_SCHEMA,
          relation: relName,
          columns: [colName],
          is_one_to_one: false, // GAP: 1:1 detection impossible from OpenAPI
          // GAP (cross-schema FK, PostgREST #1874): the schema is omitted in
          // the fk tag; we can only assume the same schema.
          referenced_schema: DEFAULT_SCHEMA,
          referenced_relation: parsed.fk.table,
          referenced_columns: [parsed.fk.column],
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // /rpc/* -> functions
  //
  // GAP (functions/RPC, the largest gap): OpenAPI describes the callable
  // surface, not catalog truth. Overloads collapse to a single path, argument
  // modes are assumed `in`, and there is no reliable return-type information, so
  // every function renders `Returns: unknown`. No SETOF / relation / prorows.
  // -------------------------------------------------------------------------
  for (const [pathKey, item] of Object.entries(doc.paths ?? {})) {
    if (!pathKey.startsWith("/rpc/")) continue;
    const fnName = pathKey.slice("/rpc/".length);
    const op = item.post;
    if (!op) continue;

    const args: PostgresFunction["args"] = [];
    for (const param of op.parameters ?? []) {
      // Body parameter carrying the arg object.
      const schema = param.schema;
      if (schema?.properties) {
        const req = new Set(schema.required ?? []);
        for (const [argName, argProp] of Object.entries(schema.properties)) {
          // Argument TYPES are recoverable: the RPC body schema carries each
          // arg's `format` (scalar like `interval`, or relation like
          // `public.users`). Return types are not — see below.
          args.push({
            mode: "in", // GAP: in/out/inout/variadic/table indistinguishable
            name: argName,
            type_id: ensureType(toColumnFormat(argProp)),
            has_default: !req.has(argName),
          });
        }
      } else if (param.in === "query" && param.name) {
        // Some args surface as query parameters.
        args.push({
          mode: "in",
          name: param.name,
          type_id: ensureType(toColumnFormat(param as OpenApiProperty)),
          has_default: !param.required,
        });
      }
    }

    functions.push({
      id: oid(`fn:${fnName}`),
      schema: DEFAULT_SCHEMA,
      name: fnName,
      language: "sql", // GAP
      definition: "", // GAP
      complete_statement: "", // GAP
      args,
      // GAP: real `argument_types` (the pg signature, e.g. "todos") is what the
      // generator uses to attach computed fields to a table Row. OpenAPI cannot
      // recover it; left empty so we neither fabricate computed fields nor inject
      // spurious ones when an arg name happens to equal a table name.
      argument_types: "",
      identity_argument_types: "", // GAP
      return_type_id: oid("type:__rpc_unknown_return__"), // not in `types` -> unknown
      return_type: "unknown", // GAP
      return_type_relation_id: null, // GAP: no SETOF/relation detection
      is_set_returning_function: false, // GAP
      prorows: null, // GAP
      behavior: "VOLATILE", // GAP
      security_definer: false, // GAP
      config_params: null, // GAP
    });
  }

  return {
    schemas: [{ id: schemaId, name: DEFAULT_SCHEMA, owner: "postgres" }],
    tables,
    foreignTables: [], // GAP: cannot distinguish from tables
    views: [], // GAP: cannot distinguish from tables
    materializedViews: [], // GAP: cannot distinguish from tables
    columns,
    relationships,
    functions,
    types,
  };
}
