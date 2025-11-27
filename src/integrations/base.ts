import { defaultConfig } from "./config/defaults.ts";
import { createChangeFilter } from "./core/filter.ts";
import { createChangeSerializer } from "./core/serialize.ts";
import type { Integration } from "./integration.types.ts";

/**
 * Base integration with safe-by-default sensitivity handling.
 * Masks all unknown options, filters known env-dependent fields.
 */
export const base: Integration = {
  filter: createChangeFilter(defaultConfig),
  serialize: createChangeSerializer(defaultConfig),
};
