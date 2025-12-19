/**
 * Logical pre-sorting for migration scripts.
 *
 * Groups changes by object type, stable ID, and scope to create a readable,
 * logically organized migration script before dependency resolution.
 *
 * This is a pre-sorting step that runs before the dependency-based topological sort.
 * It groups related changes together while preserving the ability for the dependency
 * resolver to reorder within groups when necessary.
 */

import type { Change } from "../change.types.ts";
import { getSchema } from "../integrations/filter/extractors.ts";
import { getExecutionPhase, isMetadataStableId, type Phase } from "./utils.ts";

/**
 * Object type ordering for logical grouping.
 * Lower numbers come first in the migration script.
 */
const OBJECT_TYPE_ORDER: Record<string, number> = {
  // CREATE/ALTER phase order (forward dependency)
  schema: 1,
  extension: 2,
  role: 3,
  language: 4,
  collation: 5,
  domain: 6,
  enum: 7,
  composite_type: 8,
  range: 9,
  sequence: 10,
  procedure: 11,
  aggregate: 12,
  table: 13,
  index: 14, // Grouped with tables/materialized views
  view: 15,
  materialized_view: 16,
  trigger: 17, // Grouped with tables
  rls_policy: 18, // Grouped with tables
  rule: 19, // Grouped with tables/views
  event_trigger: 20,
  publication: 21,
  subscription: 22,
};

/**
 * Scope ordering within each stable ID group.
 * Lower numbers come first.
 */
const SCOPE_ORDER_CREATE_ALTER: Record<string, number> = {
  default_privilege: 1,
  object: 2,
  comment: 3,
  privilege: 4,
  membership: 5,
};

const SCOPE_ORDER_DROP: Record<string, number> = {
  privilege: 1,
  comment: 2,
  object: 3,
};

/**
 * Sub-entity object types that should be grouped by their parent's stable ID.
 */
const SUB_ENTITY_TYPES = new Set(["index", "trigger", "rls_policy", "rule"]);

/**
 * Regex for parsing stable IDs.
 */
const CONSTRAINT_REGEX = /^constraint:([^.]+)\.([^.]+)\./;
const COLUMN_REGEX = /^column:([^.]+)\.([^.]+)\./;

/**
 * Find the object stable ID from an array of stable IDs, skipping metadata stable IDs.
 * Iterates through all stable IDs to find the first non-metadata one.
 */
function findObjectStableId(stableIds: string[]): string | null {
  for (const id of stableIds) {
    if (!isMetadataStableId(id)) {
      return id;
    }
  }
  // If all are metadata, return null (shouldn't happen, but safe fallback)
  return stableIds.length > 0 ? stableIds[0] : null;
}

/**
 * Extract the main stable ID that a change is touching.
 *
 * For sub-entities (indexes, triggers, constraints, etc.), returns the parent's stable ID.
 * For other changes, returns the primary stable ID being created/dropped/modified.
 */
function getMainStableId(change: Change): string | null {
  // For sub-entities, extract parent stable ID from requires
  if (SUB_ENTITY_TYPES.has(change.objectType)) {
    return getParentStableId(change);
  }

  // For metadata operations (comment, privilege): use requires to find object stable ID
  // Check these BEFORE CREATE/DROP/ALTER logic to ensure they group with their target objects
  if (change.scope === "comment" || change.scope === "privilege") {
    // For CREATE comments/privileges: check creates first, but extract object stable ID from requires
    if (change.operation === "create" && change.creates.length > 0) {
      const createdId = change.creates[0];
      // If creating a comment/privilege, find the object stable ID from requires
      if (isMetadataStableId(createdId)) {
        const objectId = findObjectStableId(change.requires);
        if (objectId) {
          // Check if commenting on a constraint - extract table from it
          if (objectId.startsWith("constraint:")) {
            const match = objectId.match(CONSTRAINT_REGEX);
            if (match) {
              const [, schema, table] = match;
              return `table:${schema}.${table}`;
            }
          }
          // Check if commenting on a column - extract table from it
          // Format: column:schema.table.column
          if (objectId.startsWith("column:")) {
            const match = objectId.match(COLUMN_REGEX);
            if (match) {
              const [, schema, table] = match;
              return `table:${schema}.${table}`;
            }
          }
          return objectId;
        }
      }
    }
    // For DROP/ALTER comments/privileges: find object stable ID from requires
    if (change.requires.length > 0) {
      const objectId = findObjectStableId(change.requires);
      if (objectId) {
        // Check if commenting on a constraint - extract table from it
        if (objectId.startsWith("constraint:")) {
          const match = objectId.match(CONSTRAINT_REGEX);
          if (match) {
            const [, schema, table] = match;
            return `table:${schema}.${table}`;
          }
        }
        // Check if commenting on a column - extract table from it
        // Format: column:schema.table.column
        if (objectId.startsWith("column:")) {
          const match = objectId.match(COLUMN_REGEX);
          if (match) {
            const [, schema, table] = match;
            return `table:${schema}.${table}`;
          }
        }
        return objectId;
      }
    }
    return null;
  }

  // For CREATE operations: check if creating a constraint (sub-entity of table)
  if (change.operation === "create" && change.creates.length > 0) {
    // Iterate through creates to find the first non-metadata stable ID
    const createdId = findObjectStableId(change.creates);
    if (createdId) {
      if (createdId.startsWith("constraint:")) {
        // Extract table stable ID from constraint stable ID
        // Format: constraint:schema.table.constraint_name
        const match = createdId.match(CONSTRAINT_REGEX);
        if (match) {
          const [, schema, table] = match;
          return `table:${schema}.${table}`;
        }
      }
      return createdId;
    }
    // Fallback: if all creates are metadata (shouldn't happen for non-comment scopes), use first
    return change.creates[0] ?? null;
  }

  // For DROP operations: check if dropping a constraint (sub-entity of table)
  if (change.operation === "drop" && change.drops.length > 0) {
    // Iterate through drops to find the first non-metadata stable ID
    const droppedId = findObjectStableId(change.drops);
    if (droppedId) {
      if (droppedId.startsWith("constraint:")) {
        // Extract table stable ID from constraint stable ID
        const match = droppedId.match(CONSTRAINT_REGEX);
        if (match) {
          const [, schema, table] = match;
          return `table:${schema}.${table}`;
        }
      }
      return droppedId;
    }
    // Fallback: if all drops are metadata, use first
    return change.drops[0] ?? null;
  }

  // For default_privilege operations: group by role + schema combination
  // This groups all "FOR ROLE X IN SCHEMA Y" statements together
  if (change.scope === "default_privilege") {
    if (change.requires.length > 0) {
      // Iterate through requires to find role and schema
      let grantingRole: string | null = null;
      let schemaId: string | null = null;

      for (const id of change.requires) {
        if (id.startsWith("role:")) {
          grantingRole = id;
        } else if (id.startsWith("schema:")) {
          schemaId = id;
        }
      }

      if (schemaId && grantingRole) {
        // Create composite key: "role:postgres:schema:public"
        return `${grantingRole}:${schemaId}`;
      }
      // If no schema, just group by role
      return grantingRole ?? null;
    }
  }

  // For ALTER operations: check if creating/dropping a constraint
  // Skip this for privilege/comment/default_privilege scopes (handled above)
  if (change.operation === "alter") {
    // Check creates first (ADD CONSTRAINT, ADD COLUMN, etc.)
    if (change.creates.length > 0) {
      const createdId = findObjectStableId(change.creates);
      if (createdId) {
        if (createdId.startsWith("constraint:")) {
          const match = createdId.match(CONSTRAINT_REGEX);
          if (match) {
            const [, schema, table] = match;
            return `table:${schema}.${table}`;
          }
        }
        // Extract table stable ID from column stable IDs (for ALTER TABLE ADD COLUMN)
        // Format: column:schema.table.column
        if (createdId.startsWith("column:")) {
          const match = createdId.match(COLUMN_REGEX);
          if (match) {
            const [, schema, table] = match;
            return `table:${schema}.${table}`;
          }
        }
        return createdId;
      }
      // Fallback: if all creates are metadata, use first
      return change.creates[0] ?? null;
    }
    // Check drops (DROP CONSTRAINT)
    if (change.drops && change.drops.length > 0) {
      const droppedId = findObjectStableId(change.drops);
      if (droppedId) {
        if (droppedId.startsWith("constraint:")) {
          const match = droppedId.match(CONSTRAINT_REGEX);
          if (match) {
            const [, schema, table] = match;
            return `table:${schema}.${table}`;
          }
        }
        return droppedId;
      }
      // Fallback: if all drops are metadata, use first
      return change.drops[0] ?? null;
    }
    // Otherwise use requires (VALIDATE CONSTRAINT, etc.)
    if (change.requires.length > 0) {
      const requiredId = findObjectStableId(change.requires);
      if (requiredId) {
        // Check if requiring a constraint - extract table from it
        if (requiredId.startsWith("constraint:")) {
          const match = requiredId.match(CONSTRAINT_REGEX);
          if (match) {
            const [, schema, table] = match;
            return `table:${schema}.${table}`;
          }
        }
        return requiredId;
      }
      // Fallback: if all requires are metadata, use first
      return change.requires[0] ?? null;
    }
  }

  // Fallback: try requires if available
  if (change.requires.length > 0) {
    return findObjectStableId(change.requires) ?? null;
  }

  return null;
}

/**
 * Extract parent stable ID for sub-entities (indexes, triggers, RLS policies, rules).
 *
 * Looks for table/view/materialized view stable IDs in the change's requirements.
 */
function getParentStableId(change: Change): string | null {
  const requires = change.requires;

  // Look for table, view, or materialized view stable IDs
  for (const stableId of requires) {
    if (
      stableId.startsWith("table:") ||
      stableId.startsWith("view:") ||
      stableId.startsWith("materializedView:")
    ) {
      return stableId;
    }
  }

  // Fallback: return first requires if available
  return requires.length > 0 ? requires[0] : null;
}

/**
 * Extract schema name from a change.
 * Returns the schema name if present, or null for non-schema objects.
 *
 * Uses the getSchema helper which directly accesses schema properties from change objects.
 * For default_privilege changes, accesses the inSchema property directly.
 * For event_trigger changes, groups by their function's schema.
 */
function extractSchemaFromChange(change: Change): string | null {
  // Handle default_privilege changes specially (they have inSchema property)
  if (change.scope === "default_privilege") {
    // TypeScript doesn't know about inSchema, but we know it exists for default_privilege changes
    return (change as { inSchema: string | null }).inSchema ?? null;
  }

  // Handle event_trigger changes specially - group by their function's schema
  if (change.objectType === "event_trigger") {
    return change.eventTrigger.function_schema;
  }

  // Use the getSchema helper for all other changes
  return getSchema(change);
}

/**
 * Get the effective object type for sorting purposes.
 * For sub-entities, returns the parent's object type (table/view/materialized_view).
 * For other objects, returns the object type as-is.
 */
function getEffectiveObjectType(change: Change): string {
  // For sub-entities, determine parent type from stable ID
  if (SUB_ENTITY_TYPES.has(change.objectType)) {
    const parentStableId = getParentStableId(change);
    if (parentStableId) {
      if (parentStableId.startsWith("table:")) {
        return "table";
      }
      if (parentStableId.startsWith("view:")) {
        return "view";
      }
      if (parentStableId.startsWith("materializedView:")) {
        return "materialized_view";
      }
    }
  }
  return change.objectType;
}

/**
 * Get the object type order for sorting.
 * Returns a high number for unknown types to sort them last.
 */
function getObjectTypeOrder(objectType: string): number {
  return OBJECT_TYPE_ORDER[objectType] ?? 999;
}

/**
 * Get the scope order for sorting within a stable ID group.
 */
function getScopeOrder(scope: string, phase: Phase): number {
  const orderMap =
    phase === "drop" ? SCOPE_ORDER_DROP : SCOPE_ORDER_CREATE_ALTER;
  return orderMap[scope] ?? 999;
}

/**
 * Logically pre-sort changes by grouping them into a readable structure.
 *
 * Groups changes by:
 * 1. Phase (DROP vs CREATE/ALTER)
 * 2. Object type (schema, table, index, etc.)
 * 3. Main stable ID (table:public.users, etc.)
 * 4. Scope (object, comment, privilege, etc.)
 *
 * Within each group, preserves the original order (stability).
 *
 * @param changes - Array of changes to sort
 * @returns Logically grouped and sorted array of changes
 */
export function logicalSort(changes: Change[]): Change[] {
  if (changes.length === 0) {
    return changes;
  }

  // Step 1: Partition by phase
  const changesByPhase: Record<Phase, Change[]> = {
    drop: [],
    create_alter_object: [],
  };

  for (const change of changes) {
    const phase = getExecutionPhase(change);
    changesByPhase[phase].push(change);
  }

  // Step 2: Sort each phase
  const sortedDrop = sortPhase(changesByPhase.drop, "drop");
  const sortedCreateAlter = sortPhase(
    changesByPhase.create_alter_object,
    "create_alter_object",
  );

  // Step 3: Combine phases (DROP first, then CREATE/ALTER)
  return [...sortedDrop, ...sortedCreateAlter];
}

/**
 * Sort changes within a phase by object type, stable ID, and scope.
 */
function sortPhase(changes: Change[], phase: Phase): Change[] {
  if (changes.length === 0) {
    return changes;
  }

  // Create a map to preserve original indices for stability
  const changesWithIndices = changes.map((change, index) => ({
    change,
    originalIndex: index,
  }));

  // Sort by: schema → effective object type (only when schemas differ) → stable ID → actual object type → scope → original index
  // Schema groups all objects within the same schema together
  // Effective object type ensures schemas come before tables when comparing across schemas
  // Stable ID groups sub-entities with their parents
  // Actual object type orders sub-entities within their parent group
  changesWithIndices.sort((a, b) => {
    const changeA = a.change;
    const changeB = b.change;

    // 1. Compare schemas (group objects by schema)
    const schemaA = extractSchemaFromChange(changeA);
    const schemaB = extractSchemaFromChange(changeB);

    // Non-schema objects (roles, languages, extensions, etc.) sort first
    // Use a special prefix to ensure they come before schema objects
    const schemaKeyA = schemaA === null ? "::" : schemaA;
    const schemaKeyB = schemaB === null ? "::" : schemaB;
    const schemaCompare = schemaKeyA.localeCompare(schemaKeyB);
    if (schemaCompare !== 0) {
      return schemaCompare;
    }

    // 2. Compare effective object types (parent type for sub-entities)
    // Only apply this ordering when schemas differ (for cross-schema ordering)
    // Within the same schema, we want all objects grouped together
    const effectiveTypeA = getEffectiveObjectType(changeA);
    const effectiveTypeB = getEffectiveObjectType(changeB);
    const effectiveTypeOrderA = getObjectTypeOrder(effectiveTypeA);
    const effectiveTypeOrderB = getObjectTypeOrder(effectiveTypeB);
    if (effectiveTypeOrderA !== effectiveTypeOrderB) {
      return effectiveTypeOrderA - effectiveTypeOrderB;
    }

    // 3. Compare main stable IDs (groups sub-entities with parents)
    const stableIdA = getMainStableId(changeA);
    const stableIdB = getMainStableId(changeB);
    const stableIdCompare = (stableIdA ?? "").localeCompare(stableIdB ?? "");
    if (stableIdCompare !== 0) {
      return stableIdCompare;
    }

    // 4. Compare actual object types (orders sub-entities within parent group)
    const typeOrderA = getObjectTypeOrder(changeA.objectType);
    const typeOrderB = getObjectTypeOrder(changeB.objectType);
    if (typeOrderA !== typeOrderB) {
      return typeOrderA - typeOrderB;
    }

    // 5. Compare scopes (within same stable ID and object type)
    // Special handling: comments should come after CREATE object but before ALTER object
    const scopeA = changeA.scope;
    const scopeB = changeB.scope;
    const operationA = changeA.operation;
    const operationB = changeB.operation;

    // Special case: if one is "object" scope and one is "comment" scope
    if (scopeA === "object" && scopeB === "comment") {
      // Comment comes after CREATE object, but before ALTER object
      if (operationA === "create") {
        return -1; // CREATE object comes before comment (A < B)
      } else if (operationA === "alter") {
        return 1; // ALTER object comes after comment (A > B)
      }
    } else if (scopeA === "comment" && scopeB === "object") {
      // Comment comes after CREATE object, but before ALTER object
      if (operationB === "create") {
        return 1; // CREATE object comes before comment (B < A, so A > B)
      } else if (operationB === "alter") {
        return -1; // ALTER object comes after comment (B > A, so A < B)
      }
    }

    // Special case: if one is ALTER TABLE ADD COLUMN and one is a column comment for that column
    // Column comment should come right after ADD COLUMN
    if (
      scopeA === "object" &&
      operationA === "alter" &&
      changeA.creates.length > 0 &&
      changeA.creates[0]?.startsWith("column:")
    ) {
      // This is ALTER TABLE ADD COLUMN
      const addedColumnId = changeA.creates[0];
      if (scopeB === "comment" && changeB.requires.length > 0) {
        const commentColumnId = changeB.requires[0];
        if (commentColumnId === addedColumnId) {
          return -1; // ADD COLUMN comes before its column comment
        }
      }
    }
    if (
      scopeB === "object" &&
      operationB === "alter" &&
      changeB.creates.length > 0 &&
      changeB.creates[0]?.startsWith("column:")
    ) {
      // This is ALTER TABLE ADD COLUMN
      const addedColumnId = changeB.creates[0];
      if (scopeA === "comment" && changeA.requires.length > 0) {
        const commentColumnId = changeA.requires[0];
        if (commentColumnId === addedColumnId) {
          return 1; // Column comment comes after ADD COLUMN
        }
      }
    }

    // Special case: if both are comments, ensure table comments come before column comments
    if (scopeA === "comment" && scopeB === "comment") {
      // Check if one is a table comment and one is a column comment
      const requiresA =
        changeA.requires.length > 0 ? changeA.requires[0] : null;
      const requiresB =
        changeB.requires.length > 0 ? changeB.requires[0] : null;

      // Table comments require table stable ID, column comments require column stable ID
      const isTableCommentA = requiresA?.startsWith("table:");
      const isTableCommentB = requiresB?.startsWith("table:");
      const isColumnCommentA = requiresA?.startsWith("column:");
      const isColumnCommentB = requiresB?.startsWith("column:");

      // Table comments come before column comments
      if (isTableCommentA && isColumnCommentB) {
        return -1; // Table comment comes before column comment
      }
      if (isColumnCommentA && isTableCommentB) {
        return 1; // Column comment comes after table comment
      }
    }

    // Default scope comparison
    const scopeOrderA = getScopeOrder(scopeA, phase);
    const scopeOrderB = getScopeOrder(scopeB, phase);
    if (scopeOrderA !== scopeOrderB) {
      return scopeOrderA - scopeOrderB;
    }

    // 6. Compare operations (CREATE before ALTER within same stable ID, scope, and object type)
    // This ensures CREATE ROLE comes before ALTER ROLE, CREATE SCHEMA before GRANT, etc.
    const operationOrder: Record<string, number> = {
      create: 1,
      alter: 2,
      drop: 3,
    };
    const operationOrderA = operationOrder[operationA] ?? 999;
    const operationOrderB = operationOrder[operationB] ?? 999;
    if (operationOrderA !== operationOrderB) {
      return operationOrderA - operationOrderB;
    }

    // 7. Preserve original order (stability)
    return a.originalIndex - b.originalIndex;
  });

  return changesWithIndices.map((item) => item.change);
}
