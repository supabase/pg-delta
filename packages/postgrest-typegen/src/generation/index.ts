import type { GeneratorMetadata } from "../types.ts";

export { generateGo } from "./go.ts";
export { generatePython } from "./python.ts";

export interface GenerateTypescriptOptions {
  detectOneToOneRelationships?: boolean;
  postgrestVersion?: string;
  defaultSchema?: string;
}

export interface GenerateSwiftOptions {
  accessControl?: "internal" | "public" | "private" | "package";
}

/**
 * Pure generators: `GeneratorMetadata` in, source string out. No database
 * access. Per-language options stay honest via separate functions.
 *
 * NOTE: the TypeScript and Swift implementations land in PGMETA-107. This
 * scaffold exposes their public signatures so downstream wiring can compile
 * against them.
 */
export function generateTypescript(
  _metadata: GeneratorMetadata,
  _opts?: GenerateTypescriptOptions,
): Promise<string> {
  throw new Error("generateTypescript() is not implemented yet");
}

export function generateSwift(
  _metadata: GeneratorMetadata,
  _opts?: GenerateSwiftOptions,
): string {
  throw new Error("generateSwift() is not implemented yet");
}
