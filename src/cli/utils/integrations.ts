/**
 * Utilities for loading integrations from files.
 */

import { readFile } from "node:fs/promises";
import type { IntegrationDSL } from "../../core/integrations/integration-dsl.ts";

/**
 * Load an integration DSL from a file or core integration.
 * If the path ends with .json, treats it as a JSON file path directly.
 * Otherwise, tries to load from core integrations (TypeScript) first,
 * then falls back to treating as a JSON file path.
 *
 * @param nameOrPath - Integration name (e.g., "supabase") or file path (e.g., "./my-integration.json")
 * @returns The loaded IntegrationDSL
 */
export async function loadIntegrationDSL(
  nameOrPath: string,
): Promise<IntegrationDSL> {
  // If path ends with .json, treat it as a JSON file path directly
  if (nameOrPath.endsWith(".json")) {
    const content = await readFile(nameOrPath, "utf-8");
    return JSON.parse(content) as IntegrationDSL;
  }

  // Try loading from core integrations (TypeScript) first
  try {
    const module = await import(`../../core/integrations/${nameOrPath}.ts`);
    // Core integrations export using the integration name directly (e.g., "supabase")
    const integrationName = nameOrPath;
    if (integrationName in module) {
      return module[integrationName] as IntegrationDSL;
    }
    // If no matching export, fall through to JSON file loading
  } catch {
    // Module not found or not a core integration, fall through to JSON file loading
  }

  // Fallback to treating as JSON file path
  const content = await readFile(nameOrPath, "utf-8");
  return JSON.parse(content) as IntegrationDSL;
}
