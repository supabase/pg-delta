import { AlterTableAddConstraint } from "../objects/table/changes/table.alter.ts";
import type { Rule } from "./sort-utils.ts";

/**
 * Global ordering rules for database schema changes, mirroring pg_dump's execution order.
 *
 * This rule set provides a coarse-grained, dependency-safe ordering based purely on
 * operation type (create/alter/drop), object type (table/view/etc), and scope (object/privilege/etc).
 * No graph analysis or fine-grained dependency resolution is performed at this level.
 *
 * Key principles:
 * - DROP operations come first (reverse dependency order: dependents before dependencies)
 * - CREATE/ALTER operations follow (dependency order: dependencies before dependents)
 * - Within each operation, objects are ordered by their typical dependency relationships
 *   (e.g., schemas before tables, tables before indexes)
 * - First-match-wins: a change matches the earliest rule that fits its attributes
 * - Changes not matching any rule maintain their relative input order
 *
 * This ordering resolves the vast majority of dependency issues without needing to analyze
 * individual object dependencies, making it fast and predictable. Fine-grained conflicts
 * (e.g., between ALTER TABLE operations) are resolved in a second refinement pass.
 *
 * Derived from PostgreSQL's pg_dump ordering and real-world migration execution patterns.
 */
export const pgDumpSort: Rule[] = [
  // PRE_DROP — place destructive changes first (high to low impact)
  { operation: "drop", objectType: "rls_policy", scope: "object" },
  { operation: "drop", objectType: "trigger", scope: "object" },
  { operation: "drop", objectType: "index", scope: "object" },
  { operation: "drop", objectType: "materialized_view", scope: "object" },
  { operation: "drop", objectType: "view", scope: "object" },
  // Detach partition would be here (ALTER TABLE ... DETACH PARTITION) — add scope: "partition" to target precisely
  { operation: "drop", objectType: "table", scope: "object" },
  { operation: "drop", objectType: "sequence", scope: "object" },
  { operation: "drop", objectType: "procedure", scope: "object" }, // functions/procedures
  // Types/domains/collations
  { operation: "drop", objectType: "domain", scope: "object" },
  { operation: "drop", objectType: "composite_type", scope: "object" },
  { operation: "drop", objectType: "range", scope: "object" },
  { operation: "drop", objectType: "enum", scope: "object" },
  { operation: "drop", objectType: "collation", scope: "object" },
  // Extensions, schemas, and roles last among DROPs
  { operation: "drop", objectType: "extension", scope: "object" },
  { operation: "drop", objectType: "schema", scope: "object" },
  { operation: "drop", objectType: "role", scope: "object" },

  // CREATE/ALTER — pre-data objects first
  // Roles first so subsequent objects can set ownership/memberships
  { operation: "create", objectType: "role", scope: "object" },
  { operation: "alter", objectType: "role", scope: "object" },
  { operation: "create", objectType: "schema", scope: "object" },
  { operation: "alter", objectType: "schema", scope: "object" },
  { operation: "create", objectType: "extension", scope: "object" },
  { operation: "alter", objectType: "extension", scope: "object" }, // e.g., UPDATE TO version / SET SCHEMA
  { operation: "create", objectType: "collation", scope: "object" },

  // Default privileges after roles and schemas
  { scope: "default_privilege" },

  // Types and domains
  { operation: "create", objectType: "domain", scope: "object" },
  { operation: "alter", objectType: "domain", scope: "object" },
  { operation: "create", objectType: "enum", scope: "object" },
  { operation: "alter", objectType: "enum", scope: "object" },
  { operation: "create", objectType: "range", scope: "object" },
  { operation: "alter", objectType: "range", scope: "object" },
  { operation: "create", objectType: "composite_type", scope: "object" },
  { operation: "alter", objectType: "composite_type", scope: "object" },
  // Languages and routines
  { operation: "create", objectType: "language", scope: "object" },
  { operation: "alter", objectType: "language", scope: "object" },
  { operation: "create", objectType: "procedure", scope: "object" },
  { operation: "alter", objectType: "procedure", scope: "object" },
  // Relations
  { operation: "create", objectType: "sequence", scope: "object" },
  { operation: "create", objectType: "table", scope: "object" },
  // Any alter table operation that is not an add foreign key constraint
  (change) => {
    const isAlterTable =
      change.operation === "alter" &&
      change.objectType === "table" &&
      change.scope === "object";
    const isAddForeignKeyConstraint =
      isAlterTable &&
      change instanceof AlterTableAddConstraint &&
      change.constraint.constraint_type === "f";
    return isAlterTable && !isAddForeignKeyConstraint;
  },
  { operation: "alter", objectType: "sequence", scope: "object" }, // e.g., OWNED BY / SET options — requires table/column to exist
  // Partition attach would be here (ALTER TABLE ... ATTACH PARTITION) — add scope: "partition" to target precisely
  { operation: "create", objectType: "view", scope: "object" },
  { operation: "alter", objectType: "view", scope: "object" },
  { operation: "create", objectType: "materialized_view", scope: "object" },
  { operation: "alter", objectType: "materialized_view", scope: "object" },

  // POST_CREATE — build secondary structures and policies
  // Non-FK constraints would be ordered here (ALTER TABLE ... ADD CONSTRAINT) — add scope: "constraint" to target precisely
  { operation: "create", objectType: "index", scope: "object" },
  { operation: "alter", objectType: "index", scope: "object" },
  // Foreign key constraints
  (change) => {
    return (
      change instanceof AlterTableAddConstraint &&
      change.constraint.constraint_type === "f"
    );
  },
  // Partitioned index attachments would be here (ALTER INDEX ... ATTACH PARTITION)
  { operation: "create", objectType: "trigger", scope: "object" },
  { operation: "alter", objectType: "trigger", scope: "object" },
  { operation: "create", objectType: "rls_policy", scope: "object" },
  { operation: "alter", objectType: "rls_policy", scope: "object" },

  // PRIVILEGES near the end
  { scope: "privilege" },
  { scope: "membership" },

  // COMMENT — metadata that doesn’t affect dependencies (applies to any object)
  { scope: "comment" },
];

// Suggestions for future precision (not enforced here):
// - Add scope: "partition" for ATTACH/DETACH PARTITION to place those exactly per CSV.
// - Add scope: "constraint" and possibly "column"/"attrdef" to model RELATION-ALTER and POST_CREATE constraint/default phases.
// - Add scope: "security_label" if you plan to support SECURITY LABEL ordering.
