/**
 * Canonical ordering pass for {@link GeneratorMetadata}.
 *
 * The language generators consume the metadata collections in array order.
 * This pass is the single, generator-agnostic stabilizer: it returns a new
 * `GeneratorMetadata` whose every collection is ordered so that any producer
 * (the bundled SQL `introspect()` or a custom injected adapter) yields
 * byte-stable codegen. Generators document that they expect input pre-sorted
 * with this function; ordering is intentionally NOT enforced inside
 * `introspect()` so the concern lives in one place.
 *
 * **The TypeScript generator is the source of truth for ordering.** The keys
 * below replicate the sorts that `generateTypescript` historically applied
 * internally (schemas/tables/views/functions/types/columns/relationships by
 * name; function args by name), so that generator can drop its own sorting and
 * stay byte-identical. The other generators then inherit the same canonical
 * order for free.
 *
 * Keys are **semantic** (schema + name + signature), never oid: equivalent
 * databases assign different oids, so an oid sort would still churn output
 * across environments. `id` is only a final tie-breaker for a total order.
 *
 * Composite type `attributes` and enum values are left untouched — their order
 * is semantically meaningful (struct field / enum-label order) and must be
 * preserved. Function `args` are sorted by name because PostgREST RPC args are
 * addressed by name (the generated type is an object), matching TypeScript.
 */
import type { GeneratorMetadata, PostgresRelationship } from "./types.ts";

// Relations (tables/views/materialized views/foreign tables) and types share a
// (schema, name) identity within a database; `id` breaks any residual tie.
const bySchemaName = (
  a: { schema: string; name: string; id: number },
  b: { schema: string; name: string; id: number },
): number =>
  a.schema.localeCompare(b.schema) ||
  a.name.localeCompare(b.name) ||
  a.id - b.id;

// Mirrors the TypeScript generator's historical `relationships.sort`.
const byRelationship = (
  a: PostgresRelationship,
  b: PostgresRelationship,
): number =>
  a.foreign_key_name.localeCompare(b.foreign_key_name) ||
  a.referenced_relation.localeCompare(b.referenced_relation) ||
  JSON.stringify(a.referenced_columns).localeCompare(
    JSON.stringify(b.referenced_columns),
  );

/**
 * Return a new {@link GeneratorMetadata} with every collection ordered by a
 * stable, total, semantic key (matching the TypeScript generator's ordering).
 * Pure (does not mutate the input) and idempotent. Apply this after
 * introspection and before any `generate*` call.
 */
export function sortGeneratorMetadata(
  metadata: GeneratorMetadata,
): GeneratorMetadata {
  return {
    schemas: [...metadata.schemas].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id - b.id,
    ),
    tables: [...metadata.tables].sort(bySchemaName),
    foreignTables: [...metadata.foreignTables].sort(bySchemaName),
    views: [...metadata.views].sort(bySchemaName),
    materializedViews: [...metadata.materializedViews].sort(bySchemaName),
    // Group columns by their table's (schema, name); name-order within a table
    // (matches the TypeScript generator's per-table `columns.sort(by name)`).
    columns: [...metadata.columns].sort(
      (a, b) =>
        a.schema.localeCompare(b.schema) ||
        a.table.localeCompare(b.table) ||
        a.name.localeCompare(b.name),
    ),
    relationships: [...metadata.relationships].sort(byRelationship),
    // Functions can overload, so the signature is part of the identity. Args
    // are addressed by name in generated RPC types, so sort them by name too.
    functions: [...metadata.functions]
      .sort(
        (a, b) =>
          a.schema.localeCompare(b.schema) ||
          a.name.localeCompare(b.name) ||
          a.identity_argument_types.localeCompare(b.identity_argument_types) ||
          a.id - b.id,
      )
      .map((fn) => ({
        ...fn,
        args: [...fn.args].sort((a, b) => a.name.localeCompare(b.name)),
      })),
    types: [...metadata.types].sort(bySchemaName),
  };
}
