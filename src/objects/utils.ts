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
};
