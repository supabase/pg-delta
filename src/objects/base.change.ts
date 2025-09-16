type ChangeKind = "create" | "drop" | "alter" | "replace";
export abstract class Change {
  abstract kind: ChangeKind;

  get changeId(): string {
    return `${this.kind}:${this.serialize()}`;
  }
  // A list of stableIds that this change depends on
  abstract get dependencies(): string[];
  abstract serialize(): string;
}

export abstract class CreateChange extends Change {
  kind = "create" as const;
}

export abstract class DropChange extends Change {
  kind = "drop" as const;
}

export abstract class AlterChange extends Change {
  kind = "alter" as const;
}

export abstract class ReplaceChange extends Change {
  kind = "replace" as const;
}

// Port of string literal quoting: doubles single quotes inside and wraps with single quotes
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
