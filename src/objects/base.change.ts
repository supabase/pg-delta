type ChangeOperation = "create" | "alter" | "drop";

export abstract class BaseChange {
  /**
   * The operation of the change.
   */
  abstract readonly operation: ChangeOperation;
  /**
   * The type of the object targeted by the change.
   */
  abstract readonly objectType: string;
  /**
   * The scope of the change.
   */
  abstract readonly scope: string;

  /**
   * A unique identifier for the change.
   */
  get changeId(): string {
    return `${this.operation}:${this.scope}:${this.objectType}:${this.serialize()}`;
  }

  /**
   * Stable identifiers this change creates.
   *
   * Defaults to an empty array. Override in subclasses that create objects.
   */
  get creates(): string[] {
    return [];
  }

  /**
   * Stable identifiers this change drops.
   *
   * Defaults to an empty array. Override in subclasses that remove objects.
   */
  get drops(): string[] {
    return [];
  }

  /**
   * Stable identifiers this change requires to exist beforehand.
   *
   * Defaults to an empty array. Override in subclasses that have prerequisites.
   */
  get requires(): string[] {
    return [];
  }

  /**
   * Whether this change should inherit a dependency edge from a catalog entry
   * linking {@code dependentId} to {@code referencedId}.
   *
   * Subclasses can override to ignore dependencies that are represented by a
   * separate change (e.g., ALTER statements that wire up ownership).
   */
  acceptsDependency(_dependentId: string, _referencedId: string): boolean {
    return true;
  }

  /**
   * Serialize the change into a single SQL statement.
   */
  abstract serialize(options?: Record<string, unknown>): string;
}

/**
 * Port of string literal quoting: doubles single quotes inside and wraps with single quotes
 */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
