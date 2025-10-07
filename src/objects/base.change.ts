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
   * A list of stableIds that this change depends on.
   */
  abstract get dependencies(): string[];

  /**
   * Serialize the change into a single SQL statement.
   */
  abstract serialize(): string;
}

/**
 * Port of string literal quoting: doubles single quotes inside and wraps with single quotes
 */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
