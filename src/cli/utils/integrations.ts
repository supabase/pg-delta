/**
 * Utilities for loading integrations from files.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IntegrationDSL } from "../../core/integrations/integration-dsl.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load an integration DSL from a JSON file.
 * If the path ends with .json, treats it as a file path directly.
 * Otherwise, tries to load from core/integrations/ first, then falls back to treating as a file path.
 *
 * @param nameOrPath - Integration name (e.g., "supabase") or file path (e.g., "./my-integration.json")
 * @returns The loaded IntegrationDSL
 */
export async function loadIntegrationDSL(
  nameOrPath: string,
): Promise<IntegrationDSL> {
  // If path ends with .json, treat it as a file path directly
  if (nameOrPath.endsWith(".json")) {
    const content = await readFile(nameOrPath, "utf-8");
    return JSON.parse(content) as IntegrationDSL;
  }

  // Try loading from core/integrations/ first
  // __dirname is src/cli/utils, so we go up to src/ then into core/integrations
  const coreIntegrationsPath = join(
    __dirname,
    "../../core/integrations",
    `${nameOrPath}.json`,
  );

  try {
    const content = await readFile(coreIntegrationsPath, "utf-8");
    return JSON.parse(content) as IntegrationDSL;
  } catch {
    // Fallback to treating as file path
    const content = await readFile(nameOrPath, "utf-8");
    return JSON.parse(content) as IntegrationDSL;
  }
}
