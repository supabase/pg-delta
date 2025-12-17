/**
 * Integration DSL - A serializable domain-specific language for integrations.
 *
 * Combines filter and serialization DSLs into a single serializable structure.
 */

import { compileFilterDSL, type FilterDSL } from "./filter/dsl.ts";
import type { Integration } from "./integration.types.ts";
import { compileSerializeDSL, type SerializeDSL } from "./serialize/dsl.ts";

/**
 * Integration DSL - serializable representation of an integration.
 */
export type IntegrationDSL = {
  /**
   * Filter DSL - determines which changes to include/exclude.
   * If not provided, all changes are included.
   */
  filter?: FilterDSL;
  /**
   * Serialization DSL - customizes how changes are serialized.
   * If not provided, changes are serialized with default options.
   */
  serialize?: SerializeDSL;
};

/**
 * Compile an Integration DSL to an Integration object.
 *
 * @param dsl - The integration DSL
 * @returns An Integration with compiled filter and serialize functions
 *
 * @example
 * ```ts
 * const integration = compileIntegrationDSL({
 *   filter: {
 *     or: [
 *       { type: "schema", operation: "create" },
 *       { schema: "public" }
 *     ]
 *   },
 *   serialize: [
 *     {
 *       when: { type: "schema", owner: ["service_role"] },
 *       options: { skipAuthorization: true }
 *     }
 *   ]
 * });
 * ```
 */
export function compileIntegrationDSL(dsl: IntegrationDSL): Integration {
  const integration: Integration = {};

  if (dsl.filter) {
    integration.filter = compileFilterDSL(dsl.filter);
  }

  if (dsl.serialize) {
    integration.serialize = compileSerializeDSL(dsl.serialize);
  }

  return integration;
}
