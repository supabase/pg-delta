/**
 * Filter DSL - A serializable domain-specific language for change filtering.
 */

import type { Change } from "../../change.types.ts";
import type { ChangeFilter } from "../../main.ts";
import { PROPERTY_EXTRACTORS } from "./extractors.ts";

/**
 * Core properties that all changes have.
 */
type CoreProperties = {
  type?: Change["objectType"];
  operation?: "create" | "alter" | "drop";
  scope?: Change["scope"];
};

/**
 * Extracted properties that are extracted from changes via extractor functions.
 * String value = exact match, Array value = value must be in array
 */
type ExtractedProperties = {
  schema?: string | string[];
  owner?: string | string[];
  member?: string | string[];
};

/**
 * Property pattern - matches against change properties.
 * Multiple properties are combined with AND (all must match).
 */
type PropertyPattern = CoreProperties &
  ExtractedProperties & {
    // Composition operators are NOT allowed in property patterns
    and?: never;
    or?: never;
    not?: never;
  };

/**
 * Composition pattern - combines other patterns using logical operators.
 * Composition operators are exclusive - cannot be mixed with properties.
 */
type CompositionPattern =
  | ({
      and: FilterPattern[];
      or?: never;
      not?: never;
    } & {
      [K in keyof CoreProperties]?: never;
    } & {
      [K in keyof ExtractedProperties]?: never;
    })
  | ({
      or: FilterPattern[];
      and?: never;
      not?: never;
    } & {
      [K in keyof CoreProperties]?: never;
    } & {
      [K in keyof ExtractedProperties]?: never;
    })
  | ({
      not: FilterPattern;
      and?: never;
      or?: never;
    } & {
      [K in keyof CoreProperties]?: never;
    } & {
      [K in keyof ExtractedProperties]?: never;
    });

/**
 * Filter pattern DSL.
 * Either a property pattern (matches against change properties) or
 * a composition pattern (combines other patterns using logical operators).
 * Composition operators are exclusive - cannot be mixed with properties.
 */
export type FilterPattern = PropertyPattern | CompositionPattern;

/**
 * Filter DSL - a single pattern expression.
 */
export type FilterDSL = FilterPattern;

/**
 * Evaluate a pattern against a change.
 *
 * @param pattern - The pattern to evaluate
 * @param change - The change to match against
 * @returns true if the pattern matches, false otherwise
 */
export function evaluatePattern(
  pattern: FilterPattern,
  change: Change,
): boolean {
  // Handle composition operators first (they take precedence)

  // NOT operator - negate the result
  if (pattern.not) {
    return !evaluatePattern(pattern.not, change);
  }

  // AND operator - all patterns must match
  if (pattern.and) {
    return pattern.and.every((p) => evaluatePattern(p, change));
  }

  // OR operator - any pattern must match
  if (pattern.or) {
    return pattern.or.some((p) => evaluatePattern(p, change));
  }

  // Evaluate basic pattern matching
  // Multiple properties in a pattern are combined with AND (all must match)

  // Match objectType
  if (pattern.type) {
    if (change.objectType !== pattern.type) {
      return false;
    }
  }

  // Match operation
  if (pattern.operation) {
    if (change.operation !== pattern.operation) {
      return false;
    }
  }

  // Match scope
  if (pattern.scope) {
    if (change.scope !== pattern.scope) {
      return false;
    }
  }

  // Match extracted properties
  for (const [key, value] of Object.entries(pattern)) {
    // Skip composition operators and core properties
    if (["and", "or", "not", "type", "operation", "scope"].includes(key)) {
      continue;
    }

    // Check if this is a registered property extractor
    const extractor = PROPERTY_EXTRACTORS[key];
    if (!extractor) {
      // Unknown property - ignore
      continue;
    }

    // Extract the actual value from the change
    const actualValue = extractor(change);

    // Property matching rules:
    // - String value: exact match
    // - Array value: value must be in array
    // - Missing properties (null) don't match

    if (actualValue === null) {
      return false;
    }

    if (typeof value === "string") {
      // Exact match
      if (actualValue !== value) {
        return false;
      }
    } else if (Array.isArray(value)) {
      // Value must be in array
      if (!value.includes(actualValue)) {
        return false;
      }
    } else {
      // Invalid value type - don't match
      return false;
    }
  }

  // All checks passed
  return true;
}

/**
 * Compile a Filter DSL to a ChangeFilter function.
 *
 * @param dsl - The filter DSL pattern
 * @returns A ChangeFilter function that evaluates the pattern
 *
 * @example
 * ```ts
 * const filter = compileFilterDSL({
 *   or: [
 *     { type: "schema", operation: "create" },
 *     { schema: "public" }
 *   ]
 * });
 * ```
 */
export function compileFilterDSL(dsl: FilterDSL): ChangeFilter {
  return (change: Change): boolean => {
    return evaluatePattern(dsl, change);
  };
}
