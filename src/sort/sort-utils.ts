import type { Change } from "../change.types.ts";

/**
 * A sorting rule that matches changes based on their operation, objectType, and/or scope.
 * Rules with undefined fields act as wildcards that match any value for that field.
 * For example, { operation: "drop" } matches all drop operations regardless of objectType or scope.
 *
 * Alternatively, a rule can provide a predicate function that returns true/false for any change.
 * This allows for complex matching logic that can't be expressed with static field matches.
 */
export type Rule =
  | Partial<Pick<Change, "operation" | "objectType" | "scope">>
  | ((change: Change) => boolean);

/**
 * Creates a comparator function that orders changes according to a prioritized list of rules.
 *
 * Each rule matches changes with specific combinations of operation/objectType/scope.
 * Rules are evaluated in order, and a change receives the priority of the first matching rule.
 * Changes that don't match any rule are sorted last, maintaining their relative input order.
 *
 * @param rules - Ordered list of rules, where earlier rules have higher priority
 * @returns A comparator function that can be used with Array.sort()
 */
function createComparatorFromRules(rules: Rule[]) {
  const matchIndex = (change: Change): number => {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];

      // Check if rule is a predicate function
      if (typeof rule === "function") {
        if (rule(change)) {
          return i;
        }
        continue;
      }

      // Otherwise, treat as field-based match
      if (
        (rule.operation === undefined || rule.operation === change.operation) &&
        (rule.objectType === undefined ||
          rule.objectType === change.objectType) &&
        (rule.scope === undefined || rule.scope === change.scope)
      ) {
        return i; // earlier rule = higher priority
      }
    }
    return Number.POSITIVE_INFINITY; // no rule matched
  };

  return (a: Change, b: Change): number => {
    const ra = matchIndex(a);
    const rb = matchIndex(b);
    if (ra !== rb) return ra - rb;
    // no rule tie-break: keep input order by not breaking ties here
    return 0;
  };
}

/**
 * Performs a stable sort of changes according to an ordered list of rules.
 *
 * This implements the **first pass** of the two-pass sorting strategy, providing a
 * coarse-grained global ordering based on change attributes (operation, objectType, scope)
 * without analyzing individual object dependencies.
 *
 * The sort is **stable**, meaning changes that match the same rule (or no rule) maintain
 * their relative order from the input array. This preserves any meaningful ordering from
 * the diff phase.
 *
 * **Why this is needed:**
 * - Establishes a dependency-safe baseline order (e.g., CREATE SCHEMA before CREATE TABLE)
 * - Prevents the majority of dependency conflicts before fine-grained analysis
 * - Fast: O(n log n) with no graph construction or dependency resolution
 * - Predictable: same input always produces same output regardless of dependency graphs
 *
 * After this global sort, a refinement pass handles fine-grained dependencies within
 * specific windows (e.g., ordering ALTER TABLE operations on the same table).
 *
 * @param changes - Array of changes to sort
 * @param rules - Ordered list of rules defining the desired sort order
 * @returns A new array with changes sorted according to the rules
 *
 * @example
 * ```ts
 * const sorted = sortChangesByRules(changes, [
 *   { operation: "drop", objectType: "table" },
 *   { operation: "create", objectType: "schema" },
 *   { operation: "create", objectType: "table" },
 * ]);
 * // Result: all DROP TABLE, then CREATE SCHEMA, then CREATE TABLE, then unmatched changes
 * ```
 *
 * @example
 * ```ts
 * // Using predicate functions for complex matching
 * const sorted = sortChangesByRules(changes, [
 *   { operation: "create", objectType: "table" },
 *   (change) => {
 *     // Match unique indexes created after tables but before foreign keys
 *     return change.operation === "create" &&
 *            change.objectType === "index" &&
 *            change instanceof CreateIndex &&
 *            change.index.is_unique;
 *   },
 *   (change) => {
 *     // Match foreign key constraints
 *     return change.operation === "alter" &&
 *            change instanceof AlterTableAddConstraint &&
 *            change.constraint.constraint_type === "f";
 *   },
 * ]);
 * ```
 */
export function sortChangesByRules<T extends Change>(
  changes: T[],
  rules: Rule[],
): T[] {
  const compare = createComparatorFromRules(rules);
  // stable sort: include original index as tie-breaker
  return changes
    .map((change, idx) => ({ change, idx }))
    .sort((a, b) => {
      const cmp = compare(a.change, b.change);
      return cmp !== 0 ? cmp : a.idx - b.idx;
    })
    .map(({ change }) => change);
}
