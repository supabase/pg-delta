type ChangeOperation = "create" | "alter" | "drop";

export type ChangeObjectType =
  | "extension"
  | "collation"
  | "domain"
  | "index"
  | "language"
  | "materialized_view"
  | "procedure"
  | "rls_policy"
  | "role"
  | "schema"
  | "sequence"
  | "table"
  | "trigger"
  | "enum"
  | "range"
  | "composite_type"
  | "view";

type ChangeScope =
  | "comment" // Comment on an object
  | "object" // Core DDL for the object itself
  | "privilege" // Privilege on an object
  | "default_privilege" // Default privilege for a role
  | "membership" // Membership of a role
  | "owner"; // Owner of an object

export abstract class Change {
  abstract readonly operation: ChangeOperation;
  abstract readonly objectType: ChangeObjectType;
  abstract readonly scope: ChangeScope;

  get changeId(): string {
    return `${this.operation}:${this.scope}:${this.objectType}:${this.serialize()}`;
  }
  // A list of stableIds that this change depends on
  abstract get dependencies(): string[];
  abstract serialize(): string;
}

// Port of string literal quoting: doubles single quotes inside and wraps with single quotes
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
