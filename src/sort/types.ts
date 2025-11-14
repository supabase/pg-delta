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
 * Pairwise decision for additional constraint edges.
 */
type PairwiseOrder = "a_before_b" | "b_before_a";

/**
 * Edge formats for custom constraints.
 */
type EdgeIndices = [number, number];
type EdgeObjects<TChange> = { from: TChange; to: TChange };
export type Edge<TChange> = EdgeIndices | EdgeObjects<TChange>;

/**
 * ConstraintSpec allows injecting additional ordering constraints per phase.
 *
 * - filter: limit which changes are considered by this spec
 * - groupBy: (optional) partition the filtered set; edges are applied within groups
 * - buildEdges: add explicit edges among items
 * - pairwise: compare two items and produce an ordering decision
 */
export interface ConstraintSpec<TChange extends Change> {
  filter?:
    | Partial<Pick<Change, "operation" | "objectType" | "scope">>
    | ((change: Change) => boolean); // default: entire phase
  groupBy?: (item: TChange) => string | null | undefined; // optional grouping key
  buildEdges?: (items: TChange[]) => Edge<TChange>[]; // edges within the filtered group(s)
  pairwise?: (a: TChange, b: TChange) => PairwiseOrder | undefined; // pairwise ordering
}

/**
 * Options for phase sorting.
 */
export interface PhaseSortOptions {
  /** If true, invert edges so drops run in reverse dependency order. */
  invert?: boolean;
}

/**
 * Data structures for building the dependency graph.
 */
export interface GraphData {
  /** Maps each change index to the set of stable IDs it creates. */
  createdStableIdSets: Array<Set<string>>;
  /** Maps each change index to the set of stable IDs it explicitly requires. */
  explicitRequirementSets: Array<Set<string>>;
  /** Maps each change index to the set of stable IDs it requires (includes both explicit and inferred from pg_depend). */
  requirementSets: Array<Set<string>>;
  /** Maps a stable ID to the set of change indices that create it. */
  changeIndexesByCreatedId: Map<string, Set<number>>;
  /** Maps a stable ID to the set of change indices that explicitly require it. */
  changeIndexesByExplicitRequirementId: Map<string, Set<number>>;
  /** Maps a referenced stable ID to the set of dependent stable IDs (from pg_depend). */
  dependenciesByReferencedId: Map<string, Set<string>>;
}
