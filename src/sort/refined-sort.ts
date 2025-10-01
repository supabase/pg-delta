import type { Catalog } from "../catalog.model.ts";
import type { Change } from "../objects/base.change.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableDropColumn,
} from "../objects/table/changes/table.alter.ts";
import {
  refineByTopologicalWindows,
  type TopoWindowSpec,
} from "./topo-refine.ts";

/**
 * A row from PostgreSQL's dependency catalog (pg_depend), representing one dependency edge.
 */
type PgDependRow = {
  /** The stable ID of the object that depends on another object */
  dependent_stable_id: string;
  /** The stable ID of the object being depended upon */
  referenced_stable_id: string;
};

/**
 * Creates a pairwise ordering function based on PostgreSQL dependency information.
 *
 * Given the pg_depend data, this function returns a comparator that determines whether
 * two changes have a dependency relationship. The comparator can be used with
 * `refineByTopologicalWindows` to order changes according to their actual database dependencies.
 *
 * @param depends - Array of dependency rows from pg_depend
 * @param options - Configuration options
 * @param options.invert - If true, reverse the dependency order (for DROP operations)
 * @returns A pairwise comparison function
 *
 * @example
 * ```ts
 * // For CREATE operations: referenced object before dependent object
 * const createOrder = makePairwiseFromDepends(catalog.depends);
 * // createOrder(viewA, viewB) returns "a_before_b" if viewB depends on viewA
 *
 * // For DROP operations: dependent object before referenced object (reverse)
 * const dropOrder = makePairwiseFromDepends(catalog.depends, { invert: true });
 * // dropOrder(viewA, viewB) returns "b_before_a" if viewB depends on viewA
 * ```
 */
function makePairwiseFromDepends(
  depends: PgDependRow[],
  options: { invert?: boolean } = {},
) {
  const edgesByRef = new Map<string, Set<string>>();
  for (const row of depends) {
    const ref = row.referenced_stable_id;
    const dep = row.dependent_stable_id;
    if (!edgesByRef.has(ref)) edgesByRef.set(ref, new Set());
    edgesByRef.get(ref)?.add(dep);
  }
  const hasEdge = (refs: string[], deps: string[]) => {
    for (const r of refs) {
      const outs = edgesByRef.get(r);
      if (!outs) continue;
      for (const d of deps) if (outs.has(d)) return true;
    }
    return false;
  };

  return (a: Change, b: Change) => {
    const aIds = a.dependencies,
      bIds = b.dependencies;
    if (hasEdge(aIds, bIds))
      return options.invert ? "b_before_a" : "a_before_b";
    if (hasEdge(bIds, aIds))
      return options.invert ? "a_before_b" : "b_before_a";
    return undefined;
  };
}

/**
 * Checks whether a specific dependency edge exists in the pg_depend data.
 *
 * @param depends - Array of dependency rows
 * @param dependentStableId - The stable ID of the dependent object
 * @param referencedStableId - The stable ID of the referenced object
 * @returns true if the edge exists
 */
function hasEdge(
  depends: PgDependRow[],
  dependentStableId: string,
  referencedStableId: string,
): boolean {
  for (const row of depends) {
    if (
      row.dependent_stable_id === dependentStableId &&
      row.referenced_stable_id === referencedStableId
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Context object providing access to both database catalogs for dependency resolution.
 */
interface RefinementContext {
  /** Catalog extracted from the main/base database (before changes) */
  mainCatalog: Catalog;
  /** Catalog extracted from the branch database (after changes) */
  branchCatalog: Catalog;
}

/**
 * Applies multiple refinement passes to a list of changes using window-based topological sorting.
 *
 * This is the main entry point for the **second pass** of change ordering. It takes a list
 * of changes (typically already globally sorted) and applies several specialized refinement
 * passes to resolve fine-grained dependencies.
 *
 * **Current refinement passes:**
 *
 * 1. **ALTER TABLE refinement**: Orders table alterations within the same table
 *    - DROP COLUMN before ADD COLUMN
 *    - ADD COLUMN before ADD CONSTRAINT
 *    - ADD COLUMN dependency order (for generated columns)
 *    - Primary/unique keys before foreign keys that reference them
 *
 * 2. **View/materialized view CREATE/ALTER**: Orders by dependency graph
 *    - Views are sorted so dependencies come before dependents
 *
 * 3. **View/materialized view DROP**: Orders by reverse dependency graph
 *    - Views are sorted so dependents are dropped before dependencies
 *
 * Each refinement pass operates only on specific windows of changes (e.g., consecutive
 * ALTER TABLE operations), leaving other changes untouched. Passes are applied sequentially,
 * with each pass refining the result of the previous pass.
 *
 * **Why this is needed:**
 * The global sort establishes a safe baseline order, but can't handle:
 * - Ordering multiple operations on the same table
 * - Circular dependencies at the same global sort level
 * - Fine-grained dependencies that require looking at actual object relationships
 *
 * @param ctx - Context with both database catalogs for dependency lookups
 * @param list - Array of changes (typically from global sort)
 * @returns Array of changes with refined ordering
 */
export function applyRefinements(
  ctx: RefinementContext,
  list: Change[],
): Change[] {
  // no pre-indexing; use hasEdge on ctx.branchCatalog.depends directly for reuse

  const specs: TopoWindowSpec<Change>[] = [
    {
      /**
       * Sort ALTER TABLE operations across multiple ordering rules:
       *
       * 1. Per-table: DROP COLUMN before ADD COLUMN
       *    Example:
       *      Before:
       *        ALTER TABLE users ADD COLUMN email TEXT;
       *        ALTER TABLE users DROP COLUMN old_email;
       *      After:
       *        ALTER TABLE users DROP COLUMN old_email;
       *        ALTER TABLE users ADD COLUMN email TEXT;
       *
       * 2. Per-table: ADD COLUMN before ADD CONSTRAINT
       *    Example:
       *      Before:
       *        ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
       *        ALTER TABLE users ADD COLUMN email TEXT;
       *      After:
       *        ALTER TABLE users ADD COLUMN email TEXT;
       *        ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
       *
       * 3. Per-table: ADD COLUMN dependency order (for generated/computed columns)
       *    Example:
       *      Before:
       *        ALTER TABLE users ADD COLUMN full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED;
       *        ALTER TABLE users ADD COLUMN first_name TEXT;
       *        ALTER TABLE users ADD COLUMN last_name TEXT;
       *      After:
       *        ALTER TABLE users ADD COLUMN first_name TEXT;
       *        ALTER TABLE users ADD COLUMN last_name TEXT;
       *        ALTER TABLE users ADD COLUMN full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED;
       *
       * 4. Cross-table: Primary/unique keys before foreign keys that reference them
       *    Example:
       *      Before:
       *        ALTER TABLE posts ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
       *        ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
       *      After:
       *        ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
       *        ALTER TABLE posts ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
       */
      filter: { operation: "alter", objectType: "table" },
      pairwise: (a, b) => {
        // 1) Per-table: DROP COLUMN before ADD COLUMN
        if (
          a instanceof AlterTableDropColumn &&
          b instanceof AlterTableAddColumn &&
          a.table.stableId === b.table.stableId
        )
          return "a_before_b";

        // 2) Per-table: ADD COLUMN before ADD CONSTRAINT
        if (
          a instanceof AlterTableAddColumn &&
          b instanceof AlterTableAddConstraint &&
          a.table.stableId === b.table.stableId
        )
          return "a_before_b";

        // 3) Per-table: ADD COLUMN dependency via catalog depends (column -> column)
        if (
          a instanceof AlterTableAddColumn &&
          b instanceof AlterTableAddColumn &&
          a.table.stableId === b.table.stableId
        ) {
          const schema = a.table.schema; // already normalized from extraction
          const table = a.table.name; // quote_ident-ed
          const aColId = `column:${schema}.${table}.${a.column.name}`;
          const bColId = `column:${schema}.${table}.${b.column.name}`;
          if (hasEdge(ctx.branchCatalog.depends, aColId, bColId))
            return "b_before_a"; // a depends on b
          if (hasEdge(ctx.branchCatalog.depends, bColId, aColId))
            return "a_before_b"; // b depends on a
        }

        // 4) Cross-table: key before FK
        if (
          a instanceof AlterTableAddConstraint &&
          b instanceof AlterTableAddConstraint
        ) {
          const aIsKey =
            a.constraint.constraint_type === "p" ||
            a.constraint.constraint_type === "u";
          const bIsFk = b.constraint.constraint_type === "f";
          const bRefs = b.foreignKeyTable?.stableId;
          if (aIsKey && bIsFk && bRefs === a.table.stableId)
            return "a_before_b";
        }

        return undefined;
      },
    },
    {
      /**
       * Sort views/materialized views in dependency order for CREATE/ALTER operations
       * Example: Given active_users depends on users_view
       *
       * Before:
       *   CREATE VIEW active_users AS SELECT * FROM users_view;
       *   CREATE VIEW users_view AS SELECT * FROM users;
       *
       * After:
       *   CREATE VIEW users_view AS SELECT * FROM users;
       *   CREATE VIEW active_users AS SELECT * FROM users_view;
       *
       * This ensures base views are created before their dependents
       */
      filter: (c) =>
        (c.operation === "create" || c.operation === "alter") &&
        (c.objectType === "view" || c.objectType === "materialized_view"),
      pairwise: makePairwiseFromDepends(ctx.branchCatalog.depends),
    },
    {
      /**
       * Sort views/materialized views in reverse dependency order for DROP operations
       * Example: Given active_users depends on users_view
       *
       * Before:
       *   DROP VIEW users_view;
       *   DROP VIEW active_users;
       *
       * After:
       *   DROP VIEW active_users;
       *   DROP VIEW users_view;
       *
       * This ensures dependent views are dropped before their base views
       */
      filter: (c) =>
        c.operation === "drop" &&
        (c.objectType === "view" || c.objectType === "materialized_view"),
      pairwise: makePairwiseFromDepends(ctx.mainCatalog.depends, {
        invert: true,
      }),
    },
  ];

  return specs.reduce(
    (acc, spec) => refineByTopologicalWindows(acc, spec),
    list,
  );
}
