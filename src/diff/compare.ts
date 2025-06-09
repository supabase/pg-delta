import type { ColumnDef, Constraint } from "@supabase/pg-parser/17/types";
import type { TableDefinition } from "../parse/types.ts";

// Types for the diff structure
export type ColumnDiff = {
  type: "column";
  action: "add" | "drop" | "alter";
  name: string;
  // For 'add' and 'alter', include the new definition
  newDefinition?: {
    type: string;
    nullable: boolean;
    default?: string | null;
    generated?: string;
    identity?: string;
  };
  // For 'alter', include the old definition
  oldDefinition?: {
    type: string;
    nullable: boolean;
    default?: string | null;
    generated?: string;
    identity?: string;
  };
};

export type ConstraintDiff = {
  type: "constraint";
  action: "add" | "drop";
  name?: string; // For named constraints
  key?: string; // For unnamed constraints
  definition?: {
    type: string;
    keys?: string[];
    expr?: string;
    // Add other constraint properties as needed
  };
};

export type TableDiff = {
  schema: string;
  name: string;
  changes: (ColumnDiff | ConstraintDiff)[];
};

// Types for normalized definitions
type NormalizedColumn = {
  type: string;
  nullable: boolean;
  default?: string | null;
  generated?: string;
  identity?: string;
};

type NormalizedConstraint = {
  type: string;
  keys?: string[];
  expr?: string;
};

type NormalizedTable = {
  id: string;
  schema: string;
  name: string;
  columns: Record<string, NormalizedColumn>;
  namedConstraints: Record<string, NormalizedConstraint>;
  unnamedConstraints: Record<string, NormalizedConstraint>;
};

// Helper function to remove location metadata from any object
function removeLocationMetadata(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(removeLocationMetadata);
  }

  if (obj && typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key !== "location") {
        result[key] = removeLocationMetadata(value);
      }
    }
    return result;
  }

  return obj;
}

// Helper function to normalize a column definition for comparison
function normalizeColumn(col: ColumnDef): NormalizedColumn {
  // Extract type name from the nested structure
  const typeName =
    col.typeName?.names
      ?.map((n) => ("String" in n ? n.String.sval : ""))
      .join(".") ?? "";

  // Check for NOT NULL constraint
  const hasNotNullConstraint =
    col.constraints?.some(
      (c) => "Constraint" in c && c.Constraint.contype === "CONSTR_NOTNULL",
    ) ?? false;

  return {
    type: typeName,
    nullable: !hasNotNullConstraint,
    // Add other properties as needed
  };
}

// Helper function to normalize a constraint for comparison
function normalizeConstraint(constraint: Constraint): NormalizedConstraint {
  const normalized: NormalizedConstraint = {
    type: constraint.contype ?? "UNKNOWN",
  };

  if (constraint.keys) {
    normalized.keys = constraint.keys
      .map((k) => (isPgString(k) ? k.String.sval : ""))
      .filter(Boolean);
  }

  // Handle raw_expr which can be a Node or string
  if (constraint.raw_expr) {
    if (typeof constraint.raw_expr === "string") {
      normalized.expr = constraint.raw_expr;
    } else if (
      "String" in constraint.raw_expr &&
      typeof constraint.raw_expr.String.sval === "string"
    ) {
      normalized.expr = constraint.raw_expr.String.sval;
    }
  }

  return normalized;
}

// Type guard for pg-parser String nodes
function isPgString(node: unknown): node is { String: { sval: string } } {
  return (
    typeof node === "object" &&
    node !== null &&
    "String" in node &&
    typeof (node as any).String === "object" &&
    typeof (node as any).String.sval === "string"
  );
}

// Type guard for constraint types
function isConstraintType(type: unknown): type is string {
  return typeof type === "string" && type.startsWith("CONSTR_");
}

// Helper function to generate a unique key for an unnamed constraint
function getUnnamedConstraintKey(constraint: Constraint): string {
  if (!isConstraintType(constraint.contype)) {
    return "unknown_constraint";
  }

  const parts: string[] = [constraint.contype];

  // For NOT NULL constraints, include the column name
  if (
    constraint.contype === "CONSTR_NOTNULL" &&
    typeof constraint.location === "number"
  ) {
    parts.push(`col_${constraint.location}`);
  }

  // For CHECK constraints, include the expression
  if (
    constraint.contype === "CONSTR_CHECK" &&
    typeof constraint.raw_expr === "string"
  ) {
    parts.push(`expr_${constraint.raw_expr}`);
  }

  // For UNIQUE constraints, include the column names
  if (
    constraint.contype === "CONSTR_UNIQUE" &&
    Array.isArray(constraint.keys)
  ) {
    const keyNames = constraint.keys
      .map((k) => (isPgString(k) ? k.String.sval : ""))
      .filter(Boolean)
      .join("_");
    if (keyNames) {
      parts.push(`keys_${keyNames}`);
    }
  }

  // For FOREIGN KEY constraints, include both local and foreign columns
  if (
    constraint.contype === "CONSTR_FOREIGN" &&
    isPgString(constraint.pktable)
  ) {
    const fkTable = constraint.pktable.String.sval;
    const fkCols =
      constraint.fk_attrs
        ?.map((k) => (isPgString(k) ? k.String.sval : ""))
        .filter(Boolean)
        .join("_") ?? "";
    const pkCols =
      constraint.pk_attrs
        ?.map((k) => (isPgString(k) ? k.String.sval : ""))
        .filter(Boolean)
        .join("_") ?? "";
    parts.push(`fk_${fkTable}_${fkCols}_${pkCols}`);
  }

  return parts.join("|");
}

// Helper function to normalize a table definition for comparison
function normalizeTableDefinition(table: TableDefinition): NormalizedTable {
  // Separate named and unnamed constraints
  const namedConstraints = table.constraints.filter((c) => c.conname);
  const unnamedConstraints = table.constraints.filter((c) => !c.conname);

  return {
    id: table.id,
    schema: table.schema,
    name: table.name,
    // Convert columns array to a map keyed by column name
    columns: Object.fromEntries(
      table.columns.map((col) => [col.colname ?? "", normalizeColumn(col)]),
    ) as Record<string, NormalizedColumn>,
    // Convert named constraints array to a map keyed by constraint name
    namedConstraints: Object.fromEntries(
      namedConstraints.map((c) => [c.conname!, normalizeConstraint(c)]),
    ) as Record<string, NormalizedConstraint>,
    // Convert unnamed constraints array to a map keyed by their unique identifier
    unnamedConstraints: Object.fromEntries(
      unnamedConstraints.map((c) => [
        getUnnamedConstraintKey(c),
        normalizeConstraint(c),
      ]),
    ) as Record<string, NormalizedConstraint>,
  };
}

/**
 * Compares two table definitions and returns a structured diff describing the changes needed
 * to transform the source table into the target table.
 */
export function compareTableDefinitions(
  source: TableDefinition,
  target: TableDefinition,
): TableDiff {
  const normalizedSource = normalizeTableDefinition(source);
  const normalizedTarget = normalizeTableDefinition(target);

  // Remove location metadata before comparison
  const cleanSource = removeLocationMetadata(
    normalizedSource,
  ) as NormalizedTable;
  const cleanTarget = removeLocationMetadata(
    normalizedTarget,
  ) as NormalizedTable;

  const changes: (ColumnDiff | ConstraintDiff)[] = [];

  // Compare columns
  const sourceColumns = cleanSource.columns;
  const targetColumns = cleanTarget.columns;

  // Find added and modified columns
  for (const [colName, targetCol] of Object.entries(targetColumns)) {
    const sourceCol = sourceColumns[colName];
    if (!sourceCol) {
      // Column was added
      changes.push({
        type: "column",
        action: "add",
        name: colName,
        newDefinition: targetCol,
      });
    } else if (JSON.stringify(sourceCol) !== JSON.stringify(targetCol)) {
      // Column was modified
      changes.push({
        type: "column",
        action: "alter",
        name: colName,
        oldDefinition: sourceCol,
        newDefinition: targetCol,
      });
    }
  }

  // Find dropped columns
  for (const colName of Object.keys(sourceColumns)) {
    if (!(colName in targetColumns)) {
      changes.push({
        type: "column",
        action: "drop",
        name: colName,
      });
    }
  }

  // Compare named constraints
  const sourceNamedConstraints = cleanSource.namedConstraints;
  const targetNamedConstraints = cleanTarget.namedConstraints;

  // Find added and modified named constraints
  for (const [constraintName, targetConstraint] of Object.entries(
    targetNamedConstraints,
  )) {
    const sourceConstraint = sourceNamedConstraints[constraintName];
    if (!sourceConstraint) {
      // Constraint was added
      changes.push({
        type: "constraint",
        action: "add",
        name: constraintName,
        definition: targetConstraint,
      });
    } else if (
      JSON.stringify(sourceConstraint) !== JSON.stringify(targetConstraint)
    ) {
      // Constraint was modified (drop old, add new)
      changes.push({
        type: "constraint",
        action: "drop",
        name: constraintName,
      });
      changes.push({
        type: "constraint",
        action: "add",
        name: constraintName,
        definition: targetConstraint,
      });
    }
  }

  // Find dropped named constraints
  for (const constraintName of Object.keys(sourceNamedConstraints)) {
    if (!(constraintName in targetNamedConstraints)) {
      changes.push({
        type: "constraint",
        action: "drop",
        name: constraintName,
      });
    }
  }

  // Compare unnamed constraints
  const sourceUnnamedConstraints = cleanSource.unnamedConstraints;
  const targetUnnamedConstraints = cleanTarget.unnamedConstraints;

  // Find added unnamed constraints
  for (const [constraintKey, targetConstraint] of Object.entries(
    targetUnnamedConstraints,
  )) {
    const sourceConstraint = sourceUnnamedConstraints[constraintKey];
    if (!sourceConstraint) {
      // Constraint was added
      changes.push({
        type: "constraint",
        action: "add",
        key: constraintKey,
        definition: targetConstraint,
      });
    } else if (
      JSON.stringify(sourceConstraint) !== JSON.stringify(targetConstraint)
    ) {
      // Constraint was modified (drop old, add new)
      changes.push({
        type: "constraint",
        action: "drop",
        key: constraintKey,
      });
      changes.push({
        type: "constraint",
        action: "add",
        key: constraintKey,
        definition: targetConstraint,
      });
    }
  }

  // Find dropped unnamed constraints
  for (const constraintKey of Object.keys(sourceUnnamedConstraints)) {
    if (!(constraintKey in targetUnnamedConstraints)) {
      changes.push({
        type: "constraint",
        action: "drop",
        key: constraintKey,
      });
    }
  }

  return {
    schema: source.schema,
    name: source.name,
    changes,
  };
}

// Helper function to check if tables are equal (using the diff)
export function areTablesEqual(
  source: TableDefinition,
  target: TableDefinition,
): boolean {
  const diff = compareTableDefinitions(source, target);
  return diff.changes.length === 0;
}
