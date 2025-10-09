/**
 * Base utilities and helpers for object privilege changes.
 * These functions support GRANT/REVOKE operations across different database objects.
 */

/**
 * Returns the complete set of available privileges for a given object kind.
 * This is used to determine whether a privilege list represents "ALL PRIVILEGES".
 *
 * @param kind - The PostgreSQL object kind (TABLE, VIEW, SEQUENCE, etc.)
 * @param version - The PostgreSQL version number (e.g., 170000 for 17.0.0)
 * @returns An array of privilege names available for this object kind
 */
function objectPrivilegeUniverse(
  kind: string,
  version: number | undefined,
): string[] {
  switch (kind) {
    case "TABLE": {
      const includesMaintain = (version ?? 170000) >= 170000;
      return [
        "DELETE",
        "INSERT",
        ...(includesMaintain ? (["MAINTAIN"] as const) : []),
        "REFERENCES",
        "SELECT",
        "TRIGGER",
        "TRUNCATE",
        "UPDATE",
      ];
    }
    case "VIEW": {
      // Per PostgreSQL docs, views are table-like and share the table privilege set
      // for GRANT/REVOKE purposes. Do not include MAINTAIN for views.
      return [
        "DELETE",
        "INSERT",
        "REFERENCES",
        "SELECT",
        "TRIGGER",
        "TRUNCATE",
        "UPDATE",
      ].sort();
    }
    case "MATERIALIZED VIEW": {
      const includesMaintain = (version ?? 170000) >= 170000;
      return [
        "SELECT",
        ...(includesMaintain ? (["MAINTAIN"] as const) : []),
      ].sort();
    }
    case "SEQUENCE":
      return ["SELECT", "UPDATE", "USAGE"].sort();
    case "SCHEMA":
      return ["CREATE", "USAGE"].sort();
    case "LANGUAGE":
      return ["USAGE"];
    case "TYPE":
    case "DOMAIN":
      return ["USAGE"];
    case "ROUTINE":
      return ["EXECUTE"];
    default:
      return [];
  }
}

/**
 * Checks if a privilege list represents the full set of privileges for an object kind.
 * This determines whether we can use "ALL PRIVILEGES" shorthand in SQL.
 *
 * @param kind - The PostgreSQL object kind
 * @param list - Array of privilege names to check
 * @param version - The PostgreSQL version number
 * @returns true if the list contains all available privileges for this object kind
 */
function isFullObjectPrivilegeSet(
  kind: string,
  list: string[],
  version: number | undefined,
): boolean {
  const uniqSorted = [...new Set(list)].sort();
  const fullSorted = [...objectPrivilegeUniverse(kind, version)].sort();
  if (uniqSorted.length !== fullSorted.length) return false;
  for (let i = 0; i < uniqSorted.length; i++) {
    if (uniqSorted[i] !== fullSorted[i]) return false;
  }
  return true;
}

/**
 * Formats a list of privileges for use in GRANT/REVOKE statements.
 * If the list represents all privileges, returns "ALL", otherwise returns a comma-separated list.
 *
 * @param kind - The PostgreSQL object kind
 * @param list - Array of privilege names to format
 * @param version - The PostgreSQL version number
 * @returns A SQL-formatted privilege list (either "ALL" or "PRIV1, PRIV2, ...")
 */
export function formatObjectPrivilegeList(
  kind: string,
  list: string[],
  version: number | undefined,
): string {
  const uniqSorted = [...new Set(list)].sort();
  return isFullObjectPrivilegeSet(kind, uniqSorted, version)
    ? "ALL"
    : uniqSorted.join(", ");
}

/**
 * Gets the SQL keyword prefix for a given object kind in GRANT/REVOKE statements.
 *
 * @param objectKind - The PostgreSQL object kind
 * @returns The SQL prefix (e.g., "ON SCHEMA", "ON DOMAIN", "ON")
 */
export function getObjectKindPrefix(objectKind: string): string {
  switch (objectKind) {
    case "ROUTINE":
      return "ON ROUTINE";
    case "LANGUAGE":
      return "ON LANGUAGE";
    case "SCHEMA":
      return "ON SCHEMA";
    case "SEQUENCE":
      return "ON SEQUENCE";
    case "DOMAIN":
      return "ON DOMAIN";
    case "TYPE":
      return "ON TYPE";
    default:
      return "ON";
  }
}
