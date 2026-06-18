import type { GeneratorMetadata } from "../types.ts";

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
 * NOTE: implementations land in PGMETA-106/107. This scaffold exposes the
 * public signatures so downstream wiring can compile against them.
 */
export function generateTypescript(
  _metadata: GeneratorMetadata,
  _opts?: GenerateTypescriptOptions,
): Promise<string> {
  throw new Error("generateTypescript() is not implemented yet");
}

export function generateGo(_metadata: GeneratorMetadata): string {
  throw new Error("generateGo() is not implemented yet");
}

export function generatePython(_metadata: GeneratorMetadata): string {
  throw new Error("generatePython() is not implemented yet");
}

export function generateSwift(
  _metadata: GeneratorMetadata,
  _opts?: GenerateSwiftOptions,
): string {
  throw new Error("generateSwift() is not implemented yet");
}
