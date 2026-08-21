import { splitTopLevel } from "../utils/split-top-level.ts";
import { isKnownBuiltInTypeName } from "./object-ref.ts";
import type { ObjectRef } from "./types.ts";

export const isKindCompatible = (
  requiredKind: ObjectRef["kind"],
  providedKind: ObjectRef["kind"],
): boolean => {
  if (requiredKind === "table") {
    return (
      providedKind === "table" ||
      providedKind === "view" ||
      providedKind === "materialized_view"
    );
  }
  if (requiredKind === "function") {
    return (
      providedKind === "function" ||
      providedKind === "procedure" ||
      providedKind === "aggregate"
    );
  }
  if (requiredKind === "procedure") {
    return providedKind === "procedure" || providedKind === "function";
  }
  if (requiredKind === "type") {
    return (
      providedKind === "type" ||
      providedKind === "domain" ||
      providedKind === "table" ||
      providedKind === "view" ||
      providedKind === "materialized_view"
    );
  }
  return requiredKind === providedKind;
};

type ParsedSignature = {
  args: string[];
  returnType?: string;
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

const parseSignature = (signature?: string): ParsedSignature | null => {
  if (typeof signature !== "string") {
    return null;
  }

  const trimmed = signature.trim();
  const separatorIndex = findReturnTypeSeparator(trimmed);
  const argsText =
    separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : trimmed;
  const returnType =
    separatorIndex >= 0 ? trimmed.slice(separatorIndex + 2).trim() : "";

  if (!argsText.startsWith("(") || !argsText.endsWith(")")) {
    return null;
  }

  const body = argsText.slice(1, -1).trim();
  if (body.length === 0) {
    return returnType.length > 0 ? { args: [], returnType } : { args: [] };
  }

  const args = splitTopLevel(body, ",").map((arg) => arg.trim());
  return returnType.length > 0 ? { args, returnType } : { args };
};

const signatureArgs = (signature?: string): string[] | null => {
  const parsed = parseSignature(signature);
  return parsed?.args ?? null;
};

const normalizeSignatureArg = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }
  return trimmed.toLowerCase();
};

// PostgreSQL uses canonical names internally (e.g. pg_catalog.int8) but users
// write SQL-standard aliases (e.g. bigint). This map normalizes common aliases
// so that annotation signatures like (bigint,uuid) match AST-extracted
// signatures like (pg_catalog.int8,public.uuid).
const PG_TYPE_ALIASES: Record<string, string> = {
  bigint: "int8",
  int8: "int8",
  smallint: "int2",
  int2: "int2",
  integer: "int4",
  int: "int4",
  int4: "int4",
  real: "float4",
  float4: "float4",
  "double precision": "float8",
  float8: "float8",
  boolean: "bool",
  bool: "bool",
  character: "bpchar",
  bpchar: "bpchar",
  "character varying": "varchar",
  varchar: "varchar",
  timestamp: "timestamp",
  "timestamp without time zone": "timestamp",
  timestamptz: "timestamptz",
  "timestamp with time zone": "timestamptz",
  serial: "int4",
  bigserial: "int8",
  smallserial: "int2",
};

const splitSignatureArraySuffix = (
  value: string,
): { element: string; suffix: string } => {
  let element = value;
  let suffix = "";
  while (element.endsWith("[]")) {
    element = element.slice(0, -"[]".length);
    suffix += "[]";
  }
  return { element, suffix };
};

const signatureArgBase = (value: string): string => {
  const parts = splitTopLevel(value, ".");
  const base = parts.at(-1) ?? value;
  const normalized = normalizeSignatureArg(base);
  const { element, suffix } = splitSignatureArraySuffix(normalized);
  return `${PG_TYPE_ALIASES[element] ?? element}${suffix}`;
};

const signatureArgHasSchema = (value: string): boolean =>
  splitTopLevel(value, ".").length > 1;

const signatureArgSchema = (value: string): string | undefined => {
  const parts = splitTopLevel(value, ".");
  if (parts.length <= 1) {
    return undefined;
  }
  return normalizeSignatureArg(parts.slice(0, -1).join("."));
};

const isKnownBuiltInSignatureType = (value: string): boolean => {
  const { element } = splitSignatureArraySuffix(signatureArgBase(value));
  return isKnownBuiltInTypeName(element);
};

const schemaQualifiedBuiltInArgsCompatible = (
  requiredArg: string,
  providedArg: string,
): boolean =>
  signatureArgBase(requiredArg) === signatureArgBase(providedArg) &&
  isKnownBuiltInSignatureType(requiredArg) &&
  isKnownBuiltInSignatureType(providedArg) &&
  signatureArgSchema(requiredArg) === "pg_catalog" &&
  signatureArgSchema(providedArg) === "pg_catalog";

const schemaQualifiedBuiltInArgsConflict = (
  requiredArg: string,
  providedArg: string,
): boolean => {
  if (
    signatureArgBase(requiredArg) !== signatureArgBase(providedArg) ||
    !isKnownBuiltInSignatureType(requiredArg) ||
    !isKnownBuiltInSignatureType(providedArg)
  ) {
    return false;
  }

  const requiredSchema = signatureArgSchema(requiredArg);
  const providedSchema = signatureArgSchema(providedArg);
  return (
    (requiredSchema === "pg_catalog" && providedSchema !== "pg_catalog") ||
    (providedSchema === "pg_catalog" && requiredSchema !== "pg_catalog")
  );
};

const builtInArgResolvesToCatalog = (arg: string): boolean => {
  const schema = signatureArgSchema(arg);
  return schema === undefined || schema === "pg_catalog";
};

const builtInArgsCatalogResolutionConflict = (
  requiredArg: string,
  providedArg: string,
): boolean =>
  signatureArgBase(requiredArg) === signatureArgBase(providedArg) &&
  isKnownBuiltInSignatureType(requiredArg) &&
  isKnownBuiltInSignatureType(providedArg) &&
  builtInArgResolvesToCatalog(requiredArg) !==
    builtInArgResolvesToCatalog(providedArg);

const POLYMORPHIC_PROVIDER_TYPES = new Set<string>([
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
]);

const isPolymorphicProviderArg = (value: string): boolean =>
  POLYMORPHIC_PROVIDER_TYPES.has(
    signatureArgBase(normalizeSignatureArg(value)),
  );

type SignatureArgCompatibilityOptions = {
  rejectPolymorphicProviderArgs?: boolean;
};

const signatureArgCompatible = (
  requiredArg: string,
  providedArg: string,
  options: SignatureArgCompatibilityOptions = {},
): boolean => {
  const normalizedRequired = normalizeSignatureArg(requiredArg);
  const normalizedProvided = normalizeSignatureArg(providedArg);
  if (normalizedRequired === "unknown" || normalizedRequired.length === 0) {
    return true;
  }
  if (normalizedProvided === "unknown" || normalizedProvided.length === 0) {
    return true;
  }
  if (
    isPolymorphicProviderArg(normalizedProvided) &&
    options.rejectPolymorphicProviderArgs !== true
  ) {
    return true;
  }

  if (normalizedRequired === normalizedProvided) {
    return true;
  }

  if (
    builtInArgsCatalogResolutionConflict(normalizedRequired, normalizedProvided)
  ) {
    return false;
  }

  const requiredHasSchema = signatureArgHasSchema(normalizedRequired);
  const providedHasSchema = signatureArgHasSchema(normalizedProvided);
  if (requiredHasSchema && providedHasSchema) {
    if (
      schemaQualifiedBuiltInArgsConflict(normalizedRequired, normalizedProvided)
    ) {
      return false;
    }
    return schemaQualifiedBuiltInArgsCompatible(
      normalizedRequired,
      normalizedProvided,
    );
  }

  return (
    signatureArgBase(normalizedRequired) ===
    signatureArgBase(normalizedProvided)
  );
};

const BINARY_COERCIBLE_OPERATOR_CLASS_TYPES: Record<string, string[]> = {
  cidr: ["inet"],
  varchar: ["text"],
};

const operatorClassTypeCompatible = (
  requiredArg: string,
  providedArg: string,
): boolean => {
  if (signatureArgCompatible(requiredArg, providedArg)) {
    return true;
  }

  const requiredBase = signatureArgBase(requiredArg);
  const providedBase = signatureArgBase(providedArg);
  return (
    builtInArgResolvesToCatalog(requiredArg) &&
    builtInArgResolvesToCatalog(providedArg) &&
    BINARY_COERCIBLE_OPERATOR_CLASS_TYPES[requiredBase]?.includes(
      providedBase,
    ) === true
  );
};

export const operatorClassSignaturesCompatible = (
  requiredSignature?: string,
  providedSignature?: string,
): boolean => {
  const requiredArgs = signatureArgs(requiredSignature);
  const providedArgs = signatureArgs(providedSignature);
  if (!requiredArgs || !providedArgs) {
    return signaturesCompatible(requiredSignature, providedSignature, {
      requireExactArity: true,
    });
  }

  if (requiredArgs.length === 1 && providedArgs.length === 2) {
    const requiredAccessMethod = requiredArgs[0];
    const providedAccessMethod = providedArgs[0];
    return (
      typeof requiredAccessMethod === "string" &&
      typeof providedAccessMethod === "string" &&
      signatureArgCompatible(requiredAccessMethod, providedAccessMethod)
    );
  }

  if (requiredArgs.length !== 2 || providedArgs.length !== 2) {
    return signaturesCompatible(requiredSignature, providedSignature, {
      requireExactArity: true,
    });
  }

  const requiredAccessMethod = requiredArgs[0];
  const providedAccessMethod = providedArgs[0];
  const requiredType = requiredArgs[1];
  const providedType = providedArgs[1];
  if (
    typeof requiredAccessMethod !== "string" ||
    typeof providedAccessMethod !== "string" ||
    typeof requiredType !== "string" ||
    typeof providedType !== "string"
  ) {
    return false;
  }

  return (
    signatureArgCompatible(requiredAccessMethod, providedAccessMethod) &&
    operatorClassTypeCompatible(requiredType, providedType)
  );
};

type SignatureCompatibilityOptions = {
  allowNamedArgumentsInRequirement?: boolean;
  allowVariadicProviderTail?: boolean;
  rejectPolymorphicProviderArgs?: boolean;
  requireExactArity?: boolean;
};

const isVariadicProviderArg = (value: string): boolean =>
  /^\s*variadic\s+/i.test(value);

const stripVariadicPrefix = (value: string): string =>
  value.replace(/^\s*variadic\s+/i, "").trim();

export const signaturesCompatible = (
  requiredSignature?: string,
  providedSignature?: string,
  options: SignatureCompatibilityOptions = {},
): boolean => {
  if (!requiredSignature) {
    return true;
  }

  if (
    options.allowNamedArgumentsInRequirement &&
    requiredSignature.includes("=>")
  ) {
    return true;
  }

  if (!providedSignature) {
    return false;
  }
  if (requiredSignature === providedSignature) {
    return true;
  }

  const required = parseSignature(requiredSignature);
  const provided = parseSignature(providedSignature);
  if (!required || !provided) {
    return false;
  }
  const { args: requiredArgs } = required;
  const { args: providedArgs } = provided;
  if (required.returnType) {
    if (!provided.returnType) {
      return false;
    }
    if (
      !signatureArgCompatible(required.returnType, provided.returnType, options)
    ) {
      return false;
    }
  }
  if (
    options.requireExactArity &&
    requiredArgs.length !== providedArgs.length
  ) {
    return false;
  }
  if (
    options.allowVariadicProviderTail &&
    !options.requireExactArity &&
    providedArgs.length > 0 &&
    isVariadicProviderArg(providedArgs[providedArgs.length - 1] ?? "")
  ) {
    const fixedCount = providedArgs.length - 1;
    if (requiredArgs.length < fixedCount) {
      return false;
    }
    for (let index = 0; index < fixedCount; index += 1) {
      const requiredArg = requiredArgs[index];
      const providedArg = providedArgs[index];
      if (typeof requiredArg !== "string" || typeof providedArg !== "string") {
        return false;
      }
      if (!signatureArgCompatible(requiredArg, providedArg, options)) {
        return false;
      }
    }
    const variadicArg = providedArgs[providedArgs.length - 1];
    if (typeof variadicArg !== "string") {
      return false;
    }
    const variadicBaseArg = stripVariadicPrefix(variadicArg);
    for (let index = fixedCount; index < requiredArgs.length; index += 1) {
      const requiredArg = requiredArgs[index];
      if (typeof requiredArg !== "string") {
        return false;
      }
      if (!signatureArgCompatible(requiredArg, variadicBaseArg, options)) {
        return false;
      }
    }
    return true;
  }

  // Allow fewer required args than provided: PostgreSQL functions with default
  // parameters can be called with fewer arguments than declared. For example,
  // auth.can(bigint,text,auth.action,json DEFAULT null,uuid DEFAULT ...) can be
  // called with just 3 args. We compare only the overlapping prefix so that the
  // call-site signature (N args) can match any provider with M >= N params.
  if (requiredArgs.length > providedArgs.length) {
    return false;
  }

  for (let index = 0; index < requiredArgs.length; index += 1) {
    const requiredArg = requiredArgs[index];
    const providedArg = providedArgs[index];
    if (typeof requiredArg !== "string" || typeof providedArg !== "string") {
      return false;
    }
    if (!signatureArgCompatible(requiredArg, providedArg, options)) {
      return false;
    }
  }

  return true;
};
