/**
 * Integration DSL - A serializable domain-specific language for integrations.
 *
 * Combines filter and serialization DSLs into a single serializable structure.
 */

import type { FilterDSL } from "./filter/dsl.ts";
import type { SerializeDSL } from "./serialize/dsl.ts";

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
