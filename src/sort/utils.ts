import type { Change } from "../change.types.ts";

/**
 * Execution phases for changes.
 */
export type Phase = "drop" | "create_alter_object";

/**
 * Check if a stable ID represents metadata (ACL, default privileges, comments, etc.)
 * rather than an actual database object.
 *
 * Unified check used by both logical sorting and dependency sorting.
 */
export function isMetadataStableId(stableId: string): boolean {
  return (
    stableId.startsWith("acl:") ||
    stableId.startsWith("defacl:") ||
    stableId.startsWith("aclcol:") ||
    stableId.startsWith("membership:") ||
    stableId.startsWith("comment:")
  );
}

/**
 * Determine the execution phase for a change based on its properties.
 *
 * Rules:
 * - DROP operations → drop phase
 * - CREATE operations → create_alter_object phase
 * - ALTER operations with scope="privilege" → create_alter_object phase (metadata changes)
 * - ALTER operations that drop actual objects → drop phase (destructive ALTER)
 * - ALTER operations that don't drop objects → create_alter_object phase (non-destructive ALTER)
 */
export function getExecutionPhase(change: Change): Phase {
  // DROP operations always go to drop phase
  if (change.operation === "drop") {
    return "drop";
  }

  // CREATE operations always go to create_alter phase
  if (change.operation === "create") {
    return "create_alter_object";
  }

  // For ALTER operations, determine based on what they do
  if (change.operation === "alter") {
    // Privilege changes (metadata) always go to create_alter phase
    if (change.scope === "privilege") {
      return "create_alter_object";
    }

    // Check if this ALTER drops actual objects (not metadata)
    const droppedIds = change.drops ?? [];
    const dropsObjects = droppedIds.some(
      (id: string) => !isMetadataStableId(id),
    );

    if (dropsObjects) {
      // Destructive ALTER (DROP COLUMN, DROP CONSTRAINT, etc.) → drop phase
      return "drop";
    }

    // Non-destructive ALTER (ADD COLUMN, GRANT, etc.) → create_alter phase
    return "create_alter_object";
  }

  // Safe default
  return "create_alter_object";
}
