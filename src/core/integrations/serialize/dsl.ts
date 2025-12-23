/**
 * Serialization DSL - A serializable domain-specific language for customizing change serialization.
 *
 * Reuses the filter pattern matching logic to determine when to apply serialization options.
 */

import type { Change } from "../../change.types.ts";
import { evaluatePattern, type FilterPattern } from "../filter/dsl.ts";
import type { ChangeSerializer } from "./serialize.types.ts";

/**
 * Serialization options that can be passed to change.serialize().
 */
type SerializeOptions = {
  skipAuthorization?: boolean;
  // Can be extended with more options in the future
  [key: string]: unknown;
};

/**
 * A serialization rule that applies options when a pattern matches.
 */
type SerializeRule = {
  /**
   * Pattern to match against changes.
   * Uses the same pattern matching logic as filters.
   */
  when: FilterPattern;
  /**
   * Serialization options to apply when the pattern matches.
   */
  options: SerializeOptions;
};

/**
 * Serialization DSL - array of rules evaluated in order.
 * First matching rule's options are applied.
 */
export type SerializeDSL = SerializeRule[];

/**
 * Compile a Serialization DSL to a ChangeSerializer function.
 *
 * Rules are evaluated in order, and the first matching rule's options are applied.
 * If no rule matches, the change is serialized with default options.
 *
 * @param dsl - The serialization DSL
 * @returns A ChangeSerializer function that applies the rules
 *
 * @example
 * ```ts
 * const serializer = compileSerializeDSL([
 *   {
 *     when: {
 *       type: "schema",
 *       operation: "create",
 *       owner: ["service_role"]
 *     },
 *     options: { skipAuthorization: true }
 *   }
 * ]);
 * ```
 */
export function compileSerializeDSL(dsl: SerializeDSL): ChangeSerializer {
  return (change: Change): string | undefined => {
    // Find first matching rule
    for (const rule of dsl) {
      if (evaluatePattern(rule.when, change)) {
        // Apply this rule's options
        return change.serialize(rule.options);
      }
    }

    // No rule matched - use default serialization
    return change.serialize();
  };
}
