type Comparator<T> = (a: T, b: T) => boolean;

type Indexable<T> = { [P in keyof T]: unknown };

export class UnexpectedError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "UnexpectedError";
  }
}

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
