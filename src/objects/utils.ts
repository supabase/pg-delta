type Comparator<T> = (a: T, b: T) => boolean;

type Indexable<T> = { [P in keyof T]: unknown };

/**
 * JSON.stringify replacement that safely serializes BigInt values by converting
 * them to strings. This ensures stable serialization for deep equality checks
 * without throwing on BigInt instances.
 */
export function stringifyWithBigInt(value: unknown, space: number = 2): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    space,
  );
}

export function hasNonAlterableChanges<T, K extends keyof T>(
  main: T,
  branch: T,
  keys: ReadonlyArray<K>,
  comparators?: Partial<Record<K, Comparator<unknown>>>,
): boolean {
  const mainIndexable = main as unknown as Indexable<T>;
  const branchIndexable = branch as unknown as Indexable<T>;
  for (const key of keys) {
    // Prefer custom comparator when provided; fallback to strict equality
    const equals =
      (comparators?.[key] as Comparator<unknown>) ??
      ((a: unknown, b: unknown) => a === b);
    if (!equals(mainIndexable[key], branchIndexable[key])) return true;
  }
  return false;
}

export const deepEqual: Comparator<unknown> = (a: unknown, b: unknown) =>
  stringifyWithBigInt(a) === stringifyWithBigInt(b);

// Helpers for stableId that aren't encoded in a class, mostly for sub-entities or meta entities.
export const stableId = {
  schema(schema: string) {
    return `schema:${schema}` as const;
  },
  table(schema: string, table: string) {
    return `table:${schema}.${table}` as const;
  },
  view(schema: string, view: string) {
    return `view:${schema}.${view}` as const;
  },
  materializedView(schema: string, view: string) {
    return `materializedView:${schema}.${view}` as const;
  },
  acl(objectStableId: string, grantee: string) {
    return `acl:${objectStableId}::grantee:${grantee}` as const;
  },
  /**
   *
   * 'defacl:' || grantor || ':' || objtype || ':' || coalesce('schema:' || in_schema, 'global') || ':grantee:' || grantee as dependent_stable_id,
   */
  defacl(
    grantor: string,
    objtype: string,
    schema: string | null,
    grantee: string,
  ) {
    return `defacl:${grantor}:${objtype}:${schema ? `schema:${schema}` : "global"}:grantee:${grantee}` as const;
  },
  column(schema: string, table: string, column: string) {
    return `column:${schema}.${table}.${column}` as const;
  },
  constraint(schema: string, table: string, constraint: string) {
    return `constraint:${schema}.${table}.${constraint}` as const;
  },
  comment(objectStableId: string) {
    return `comment:${objectStableId}` as const;
  },
  role(role: string) {
    return `role:${role}` as const;
  },
  type(schema: string, name: string) {
    return `type:${schema}.${name}` as const;
  },
  collation(schema: string, name: string) {
    return `collation:${schema}.${name}` as const;
  },
};

/**
 * Check if a schema name represents a user-defined type (not pg_catalog or information_schema).
 * Used to filter out system types when building dependency lists.
 */
export function isUserDefinedTypeSchema(
  schema: string | null | undefined,
): boolean {
  return (
    schema != null && schema !== "pg_catalog" && schema !== "information_schema"
  );
}

/**
 * Parse a procedure reference string (from regprocedure::text) to extract schema and function name.
 * Format: "schema.function_name(argtypes)" or "function_name(argtypes)"
 * Returns null if parsing fails or if it's a system procedure.
 */
export function parseProcedureReference(
  procRef: string | null | undefined,
): { schema: string; name: string } | null {
  if (!procRef) return null;

  // Format is "schema.function_name(argtypes)" or "function_name(argtypes)"
  // Extract everything before the opening parenthesis
  const match = procRef.match(/^([^(]+)\(/);
  if (!match) return null;

  const qualifiedName = match[1];
  const parts = qualifiedName.split(".");
  if (parts.length === 1) {
    // No schema prefix - assume current schema (we can't determine it here)
    // For now, skip these as we need schema info
    return null;
  }
  if (parts.length === 2) {
    const [schema, name] = parts;
    if (isUserDefinedTypeSchema(schema)) {
      return { schema, name };
    }
  }
  return null;
}

/**
 * Parse a type string (from format_type) to extract schema and type name if it's schema-qualified.
 * Format: "type_name" or "schema.type_name" or "schema.type_name[]"
 * Returns null if it's not schema-qualified or if it's a system type.
 */
export function parseTypeString(
  typeStr: string | null | undefined,
): { schema: string; name: string } | null {
  if (!typeStr) return null;

  // Remove array brackets for parsing
  const baseType = typeStr.replace(/\[\]+$/, "");

  // Check if it's schema-qualified (contains a dot)
  const parts = baseType.split(".");
  if (parts.length === 2) {
    const [schema, name] = parts;
    if (isUserDefinedTypeSchema(schema)) {
      return { schema, name };
    }
  }
  return null;
}
