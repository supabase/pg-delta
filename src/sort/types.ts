import type { Change } from "../change.types.ts";

/**
 * pg_depend rows that matter for ordering.
 *
 * These represent dependency relationships extracted from PostgreSQL's pg_depend catalog.
 */
export type PgDependRow = {
  /** Object that depends on `referenced_stable_id`. */
  dependent_stable_id: string;
  /** Object being depended upon. */
  referenced_stable_id: string;
  /**
   * Dependency type as defined in PostgreSQL's pg_depend.deptype.
   *
   * - "n" (normal): Ordinary dependency — if the referenced object is dropped, the dependent object is also dropped automatically.
   * - "a" (auto): Automatically created dependency — the dependent object was created as a result of creating the referenced object,
   *   and should be dropped automatically when the referenced object is dropped, but not otherwise treated as a strong link.
   * - "i" (internal): Internal dependency — the dependent object is a low-level part of the referenced object.
   */
  deptype: "n" | "a" | "i";
};

/**
 * Constraint representing that one change must come before another.
 *
 * Unified abstraction for all ordering requirements:
 * - Catalog dependencies (from pg_depend) → Constraints
 * - Explicit requirements (from Change.requires) → Constraints
 * - Constraint specs (change-to-change rules) → Constraints
 */
export type Constraint =
  | CatalogConstraint
  | ExplicitConstraint
  | ConstraintSpecConstraint;

/**
 * Base constraint properties shared by all constraint types.
 */
interface BaseConstraint {
  /** Index of the change that must come first */
  sourceChangeIndex: number;
  /** Index of the change that must come after */
  targetChangeIndex: number;
}

/**
 * Constraint from catalog dependencies (pg_depend).
 * Always has both dependent and referenced stable IDs.
 */
export interface CatalogConstraint extends BaseConstraint {
  source: "catalog";
  /** The stable ID dependency that led to this constraint */
  reason: {
    /** The stable ID that depends on referencedStableId */
    dependentStableId: string;
    /** The stable ID being depended upon */
    referencedStableId: string;
  };
}

/**
 * Constraint from explicit requirements (Change.requires).
 * Always has referencedStableId, but dependentStableId is optional
 * if the change doesn't create anything.
 */
export interface ExplicitConstraint extends BaseConstraint {
  source: "explicit";
  /** The stable ID dependency that led to this constraint */
  reason: {
    /** The stable ID that depends on referencedStableId (undefined if change doesn't create anything) */
    dependentStableId?: string;
    /** The stable ID being depended upon */
    referencedStableId: string;
  };
}

/**
 * Constraint from custom constraint specs.
 * No reason field since these are direct change-to-change ordering rules.
 */
export interface ConstraintSpecConstraint extends BaseConstraint {
  source: "custom";
  /** Optional description for debugging */
  description?: string;
}

/**
 * Pairwise ordering decision for two changes.
 */
export type PairwiseOrder = "a_before_b" | "b_before_a";

/**
 * Custom constraint that decides ordering between two changes.
 *
 * Takes two changes and returns whether a should come before b, b should come before a,
 * or undefined if there's no ordering constraint between them.
 */
export type CustomConstraint = (
  a: Change,
  b: Change,
) => PairwiseOrder | undefined;

export interface PhaseSortOptions {
  /** If true, invert edges so drops run in reverse dependency order. */
  invert?: boolean;
}

/**
 * Edge with its originating constraint for filtering purposes.
 */
export interface Edge {
  sourceIndex: number;
  targetIndex: number;
  constraint: Constraint;
}

/**
 * Graph data structures for converting dependencies to Constraints.
 */
export interface GraphData {
  /** Maps each change index to the set of stable IDs it creates. */
  createdStableIdSets: Array<Set<string>>;
  /** Maps each change index to the set of stable IDs it explicitly requires. */
  explicitRequirementSets: Array<Set<string>>;
  /** Maps a stable ID to the set of change indices that create it. */
  changeIndexesByCreatedId: Map<string, Set<number>>;
  /** Maps a stable ID to the set of change indices that explicitly require it. */
  changeIndexesByExplicitRequirementId: Map<string, Set<number>>;
}
