import type { GeneratorMetadata } from "../types.ts";

/**
 * Minimal structural database interface. `pg.Pool` / `pg.Client` satisfy it,
 * as do Bun and other drivers. postgres-meta injects its forked-pg pool here,
 * keeping its own error handling on its side of the boundary. Errors throw;
 * callers adapt.
 */
export interface Queryable {
  query(sql: string): Promise<{ rows: any[] }>;
}

export interface IntrospectOptions {
  includedSchemas?: string[];
  excludedSchemas?: string[];
}

/**
 * Introspect a database into the `GeneratorMetadata` contract by running the
 * ported postgres-meta SQL builders directly.
 *
 * NOTE: implementation lands in PGMETA-108/110. This scaffold exposes the
 * public signature so downstream wiring can compile against it.
 */
export function introspect(
  _db: Queryable,
  _opts?: IntrospectOptions,
): Promise<GeneratorMetadata> {
  throw new Error("introspect() is not implemented yet");
}
