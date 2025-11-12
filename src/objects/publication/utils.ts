import type {
  Publication,
  PublicationTableProps,
} from "./publication.model.ts";

function wrapRowFilter(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed;
  }
  return `(${trimmed})`;
}

export function formatPublicationTable(table: PublicationTableProps): string {
  let clause = `TABLE ${table.schema}.${table.name}`;
  if (table.columns && table.columns.length > 0) {
    clause += ` (${table.columns.join(", ")})`;
  }
  if (table.row_filter) {
    clause += ` WHERE ${wrapRowFilter(table.row_filter)}`;
  }
  return clause;
}

export function formatPublicationObjects(
  tables: PublicationTableProps[],
  schemas: string[],
): string[] {
  const clauses: string[] = [];
  for (const table of tables) {
    clauses.push(formatPublicationTable(table));
  }
  for (const schema of schemas) {
    clauses.push(`TABLES IN SCHEMA ${schema}`);
  }
  return clauses;
}

export function getPublicationOperations(publication: Publication): string[] {
  const operations: string[] = [];
  if (publication.publish_insert) operations.push("insert");
  if (publication.publish_update) operations.push("update");
  if (publication.publish_delete) operations.push("delete");
  if (publication.publish_truncate) operations.push("truncate");
  return operations;
}

export function isDefaultPublicationOperations(publication: Publication) {
  return (
    publication.publish_insert &&
    publication.publish_update &&
    publication.publish_delete &&
    publication.publish_truncate
  );
}
