import { splitTopLevel } from "../utils/split-top-level.ts";
import type { ObjectKind, ObjectRef } from "./types.ts";

const BUILTIN_TYPES = new Set([
  "aclitem",
  "any",
  "anyarray",
  "anycompatible",
  "anycompatiblearray",
  "anycompatiblenonarray",
  "anycompatiblemultirange",
  "anycompatiblerange",
  "anyelement",
  "anyenum",
  "anymultirange",
  "anynonarray",
  "anyrange",
  "bool",
  "box",
  "bpchar",
  "bytea",
  "char",
  "circle",
  "cid",
  "cidr",
  "datemultirange",
  "daterange",
  "date",
  "cstring",
  "event_trigger",
  "fdw_handler",
  "float4",
  "float8",
  "inet",
  "index_am_handler",
  "int2vector",
  "int2",
  "int4",
  "int8",
  "int4multirange",
  "int4range",
  "int8multirange",
  "int8range",
  "internal",
  "interval",
  "json",
  "jsonb",
  "jsonpath",
  "language_handler",
  "line",
  "lseg",
  "macaddr",
  "macaddr8",
  "money",
  "name",
  "numeric",
  "nummultirange",
  "numrange",
  "oid",
  "oidvector",
  "path",
  "pg_lsn",
  "pg_snapshot",
  "point",
  "polygon",
  "record",
  "regclass",
  "regconfig",
  "regdictionary",
  "regnamespace",
  "regoper",
  "regoperator",
  "regproc",
  "regprocedure",
  "regrole",
  "regtype",
  "table_am_handler",
  "text",
  "time",
  "timestamp",
  "timestamptz",
  "timetz",
  "tsquery",
  "tsmultirange",
  "tsrange",
  "tstzmultirange",
  "tstzrange",
  "tsvector",
  "trigger",
  "tsm_handler",
  "tid",
  "unknown",
  "uuid",
  "varchar",
  "varbit",
  "bit",
  "void",
  "xml",
  "xid",
  "xid8",
]);

const BUILTIN_INDEX_ACCESS_METHODS = new Set([
  "brin",
  "btree",
  "gin",
  "gist",
  "hash",
  "spgist",
]);

const BUILTIN_TABLE_ACCESS_METHODS = new Set(["heap"]);

export const isKnownBuiltInTypeName = (name: string): boolean =>
  BUILTIN_TYPES.has(name.toLowerCase());

export const DEFAULT_SCHEMA = "public";

type IdentifierSource = "raw" | "ast";

const normalizeIdentifierInternal = (
  value: string,
  source: IdentifierSource,
): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }

  if (source === "raw") {
    return trimmed.toLowerCase();
  }

  return trimmed;
};

export const normalizeIdentifier = (value: string): string =>
  normalizeIdentifierInternal(value, "raw");

const normalizeTypeExpression = (value: string): string => {
  let out = "";
  let inQuotes = false;
  let pendingSpace = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    const nextChar = value[index + 1];
    if (!char) {
      continue;
    }

    if (char === '"') {
      if (pendingSpace && out.length > 0) {
        out += " ";
      }
      pendingSpace = false;
      out += char;
      if (inQuotes && nextChar === '"') {
        out += nextChar;
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (inQuotes) {
      out += char;
      continue;
    }

    if (/\s/u.test(char)) {
      pendingSpace = true;
      continue;
    }

    if (pendingSpace && out.length > 0 && !",()[]".includes(char)) {
      out += " ";
    }
    pendingSpace = false;
    out += char.toLowerCase();
  }

  return out
    .trim()
    .replace(/\s*,\s*/gu, ",")
    .replace(/\(\s*/gu, "(")
    .replace(/\s*\)/gu, ")");
};

const findReturnTypeSeparator = (value: string): number => {
  let depth = 0;
  let inQuotes = false;

  for (let index = 0; index < value.length - 1; index += 1) {
    const char = value[index] ?? "";
    const nextChar = value[index + 1] ?? "";

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (inQuotes) {
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")" && depth > 0) {
      depth -= 1;
      continue;
    }

    if (depth === 0 && char === "-" && nextChar === ">") {
      return index;
    }
  }

  return -1;
};

export const normalizeSignature = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const separatorIndex = findReturnTypeSeparator(trimmed);
  const argsText =
    separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : trimmed;
  const returnText =
    separatorIndex >= 0 ? trimmed.slice(separatorIndex + 2).trim() : "";

  let body = argsText;
  if (body.startsWith("(") && body.endsWith(")")) {
    body = body.slice(1, -1);
  }

  const normalizedReturn =
    returnText.length > 0 ? `->${normalizeTypeExpression(returnText)}` : "";

  if (body.trim().length === 0) {
    return `()${normalizedReturn}`;
  }

  const args = splitTopLevel(body, ",").map((arg) =>
    normalizeTypeExpression(arg),
  );
  return `(${args.join(",")})${normalizedReturn}`;
};

export const createObjectRef = (
  kind: ObjectKind,
  name: string,
  schema?: string,
  signature?: string,
  source: IdentifierSource = "raw",
): ObjectRef => ({
  kind,
  name: normalizeIdentifierInternal(name, source),
  schema: schema ? normalizeIdentifierInternal(schema, source) : undefined,
  signature: signature ? normalizeSignature(signature) : undefined,
});

export const createObjectRefFromAst = (
  kind: ObjectKind,
  name: string,
  schema?: string,
  signature?: string,
): ObjectRef => createObjectRef(kind, name, schema, signature, "ast");

const markObjectRefFlag = (
  ref: ObjectRef,
  key:
    | "exactKind"
    | "exactSignature"
    | "omitIfNoLocalProducer"
    | "implicitProvider"
    | "explicitSchema",
): ObjectRef => {
  Object.defineProperty(ref, key, {
    configurable: true,
    enumerable: false,
    value: true,
  });
  return ref;
};

export const markExactKindRef = (ref: ObjectRef): ObjectRef =>
  markObjectRefFlag(ref, "exactKind");

export const requiresExactKind = (ref: ObjectRef): boolean =>
  ref.exactKind === true;

export const markExactSignatureRef = (ref: ObjectRef): ObjectRef =>
  markObjectRefFlag(ref, "exactSignature");

export const requiresExactSignature = (ref: ObjectRef): boolean =>
  ref.exactSignature === true;

export const markOmitIfNoLocalProducerRef = (ref: ObjectRef): ObjectRef =>
  markObjectRefFlag(ref, "omitIfNoLocalProducer");

export const shouldOmitIfNoLocalProducer = (ref: ObjectRef): boolean =>
  ref.omitIfNoLocalProducer === true;

export const markAlternativeRef = (
  ref: ObjectRef,
  alternativeKey: string,
): ObjectRef => {
  Object.defineProperty(ref, "alternativeKey", {
    configurable: true,
    enumerable: false,
    value: alternativeKey,
  });
  return ref;
};

export const alternativeRefKey = (ref: ObjectRef): string | undefined =>
  ref.alternativeKey;

export const markImplicitProviderRef = (ref: ObjectRef): ObjectRef =>
  markObjectRefFlag(ref, "implicitProvider");

export const isImplicitProvider = (ref: ObjectRef): boolean =>
  ref.implicitProvider === true;

export const markExplicitSchemaRef = (ref: ObjectRef): ObjectRef =>
  markObjectRefFlag(ref, "explicitSchema");

// CREATE TYPE name; creates a shell type that support routines can reference,
// but ordinary consumers still need the later concrete type definition.
export const SHELL_TYPE_SIGNATURE = "(shell)";

export const isShellTypeRef = (ref: ObjectRef): boolean =>
  ref.kind === "type" && ref.signature === SHELL_TYPE_SIGNATURE;

export const objectRefKey = (ref: ObjectRef): string => {
  const schema = ref.schema ?? "";
  const signature = ref.signature ?? "";
  return `${ref.kind}:${schema}:${ref.name}:${signature}`;
};

export const dedupeObjectRefs = (refs: ObjectRef[]): ObjectRef[] => {
  const map = new Map<string, ObjectRef>();
  for (const ref of refs) {
    const key = objectRefKey(ref);
    const existing = map.get(key);
    if (
      !existing ||
      (ref.explicitSchema === true && !existing.explicitSchema)
    ) {
      map.set(key, ref);
    }
  }
  return [...map.values()];
};

export const isBuiltInObjectRef = (ref: ObjectRef): boolean => {
  const schemaLower = ref.schema?.toLowerCase();
  const nameLower = ref.name.toLowerCase();

  if (schemaLower === "pg_catalog" || schemaLower === "information_schema") {
    return true;
  }

  if (ref.kind === "schema" && nameLower === DEFAULT_SCHEMA) {
    return true;
  }

  if (ref.kind === "role") {
    return true;
  }

  if (ref.kind === "access_method") {
    const signature = ref.signature?.trim().toLowerCase();
    if (!signature) {
      return (
        BUILTIN_INDEX_ACCESS_METHODS.has(nameLower) ||
        BUILTIN_TABLE_ACCESS_METHODS.has(nameLower)
      );
    }
    if (signature === "(index)") {
      return BUILTIN_INDEX_ACCESS_METHODS.has(nameLower);
    }
    if (signature === "(table)") {
      return BUILTIN_TABLE_ACCESS_METHODS.has(nameLower);
    }
  }

  if (
    ref.kind === "type" &&
    (!schemaLower || (schemaLower === DEFAULT_SCHEMA && !ref.explicitSchema)) &&
    BUILTIN_TYPES.has(nameLower)
  ) {
    return true;
  }

  if (ref.kind === "type" && nameLower.endsWith("[]")) {
    if (schemaLower && (schemaLower !== DEFAULT_SCHEMA || ref.explicitSchema)) {
      return false;
    }
    return BUILTIN_TYPES.has(nameLower.slice(0, -"[]".length));
  }

  return false;
};

export const splitQualifiedName = (
  value: string,
  source: IdentifierSource = "raw",
): { schema?: string; name: string } => {
  const parts = splitTopLevel(value, ".");
  if (parts.length <= 1) {
    return { name: normalizeIdentifierInternal(value, source) };
  }

  return {
    schema: normalizeIdentifierInternal(parts.slice(0, -1).join("."), source),
    name: normalizeIdentifierInternal(parts.at(-1) ?? "", source),
  };
};
