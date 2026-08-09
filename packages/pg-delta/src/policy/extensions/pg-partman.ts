/**
 * pg_partman handler (docs/architecture/extension-intent.md §3.3, Deliverable A).
 *
 * pg_partman child partitions are real user-schema tables that carry NO
 * `pg_depend` edge to the extension (so the core extractor's `deptype='e'`
 * anti-join keeps them as facts) and cannot be told apart from a user-declared
 * `PARTITION OF` by `relispartition` alone (CLI-1591). The ONLY authoritative
 * signal is `<partman_schema>.part_config`: a table is partman-managed iff its
 * `pg_inherits` parent (transitively) is registered there.
 *
 * `part_config` is not `pg_catalog`, so this lives in the integration layer.
 * Phase A emits a `managedBy` edge from each managed child to the pg_partman
 * extension fact; `excludeManaged` then drops those children from the diff so
 * a declarative sync never `DROP`s them (CLI-1555). Native AND legacy
 * (trigger-based) partitioning both use `pg_inherits`, so the recursive walk
 * covers every level, including `*_default` and premade children.
 */
import type { DependencyEdge, FactBase } from "../../core/fact.ts";
import type {
  CaptureResult,
  ExtensionHandler,
  HandlerContext,
} from "../../extract/handler.ts";
import type { StableId } from "../../core/stable-id.ts";

const PG_PARTMAN: StableId = { kind: "extension", name: "pg_partman" };

/** Double-quote a SQL identifier (the partman schema is dynamic). */
function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Resolve the schema pg_partman is installed into, or null if absent. */
async function detect(ctx: HandlerContext): Promise<string | null> {
  const rows = await ctx.query(
    `SELECT n.nspname AS schema
       FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'pg_partman'`,
  );
  return (rows[0]?.["schema"] as string | undefined) ?? null;
}

export const pgPartmanHandler: ExtensionHandler = {
  extension: "pg_partman",

  async capture(
    ctx: HandlerContext,
    current: FactBase,
  ): Promise<CaptureResult> {
    const schema = await detect(ctx);
    if (schema === null) return { facts: [], edges: [] };

    // Every table inheriting (directly or transitively) from a parent
    // registered in part_config is partman-managed.
    const rows = await ctx.query(
      `WITH RECURSIVE managed_parents AS (
         SELECT to_regclass(parent_table)::oid AS oid
           FROM ${quoteIdent(schema)}.part_config
          WHERE to_regclass(parent_table) IS NOT NULL
       ),
       descendants AS (
         SELECT i.inhrelid AS oid
           FROM pg_inherits i
          WHERE i.inhparent IN (SELECT oid FROM managed_parents)
         UNION ALL
         SELECT i.inhrelid
           FROM pg_inherits i
           JOIN descendants d ON i.inhparent = d.oid
       )
       SELECT n.nspname AS schema, c.relname AS name
         FROM descendants d
         JOIN pg_class c ON c.oid = d.oid
         JOIN pg_namespace n ON n.oid = c.relnamespace`,
    );

    const edges: DependencyEdge[] = [];
    for (const row of rows) {
      const child: StableId = {
        kind: "table",
        schema: String(row["schema"]),
        name: String(row["name"]),
      };
      // only tag children that are actually facts (avoid dangling edges)
      if (!current.has(child)) continue;
      edges.push({ from: child, to: PG_PARTMAN, kind: "managedBy" });
    }
    return { facts: [], edges };
  },
};
