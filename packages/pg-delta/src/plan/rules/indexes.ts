/** Rule definitions for standalone indexes. */
import { rel } from "../render.ts";
import type { KindRules } from "../rules.ts";
import { p, renameRule, str } from "./helpers.ts";

export const indexRules: Record<string, KindRules> = {
  index: {
    weight: 14,
    cascadesToChildren: true,
    rebuildable: true,
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER INDEX ${rel(id.schema, id.name)}`;
    }),
    create: (fact, view, params) => {
      const def = str(p(fact, "def"));
      // PostgreSQL REJECTS `CREATE INDEX CONCURRENTLY` on a partitioned table's
      // parent index (relkind='p') — the parent index is metadata-only and is
      // materialized by building each partition's own index, so there is
      // nothing to build concurrently at the parent. Detect it via the parent
      // TABLE fact's `partitionKey` (the `PARTITION BY` clause, null for
      // ordinary tables) and keep the create plain/transactional; each
      // partition's index attachment still builds normally. (Building each
      // partition's index concurrently then attaching is out of scope.)
      const parentTable =
        fact.parent?.kind === "table" ? view.get(fact.parent) : undefined;
      const parentIsPartitioned =
        parentTable != null && p(parentTable, "partitionKey") != null;
      if (params?.["concurrentIndexes"] === true && !parentIsPartitioned) {
        // pg_get_indexdef never includes CONCURRENTLY (an execution choice,
        // not state); splice it into the canonical def
        return [
          {
            sql: def.replace(
              /^CREATE (UNIQUE )?INDEX /,
              "CREATE $1INDEX CONCURRENTLY ",
            ),
            lockClass: "shareUpdateExclusive",
            transactionality: "nonTransactional",
          },
        ];
      }
      return [{ sql: def }];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP INDEX ${rel(id.schema, id.name)}` };
    },
    // `valid` (pg_index.indisvalid) participates in the diff: an invalid index
    // (failed CREATE INDEX CONCURRENTLY) differs from the desired valid one even
    // when their `def` is identical, and the only repair is drop + recreate —
    // hence "replace", same strategy as `def`. See extract/relations.ts.
    attributes: { def: "replace", valid: "replace" },
  },
};
