/**
 * pgmq handler (docs/architecture/extension-intent.md §4.1, CLI-2054).
 *
 * A pgmq QUEUE is not schema DDL: `pgmq.create('jobs')` is a function call that
 * registers a row in pgmq's own `pgmq.meta` registry and creates two
 * operational tables (`pgmq.q_jobs`, `pgmq.a_jobs`). So the queue is captured
 * from `pgmq.meta` as an `extensionIntent` fact keyed by `queue_name` and
 * replayed through pgmq's OWN API — never reconstructed as `CREATE TABLE`.
 *
 * `queue_name` is the registry's UNIQUE key (`meta_queue_name_key`) and pgmq
 * validates it on the way in (`pgmq.validate_queue_name`), so — unlike pg_cron,
 * whose `jobname` is nullable and non-unique — a pgmq queue can never be
 * unkeyable. This handler therefore ships none of pg_cron's empty-name /
 * duplicate-name machinery; there is no case for it to handle.
 *
 * OWNERSHIP NORMALIZATION (CLI-2054 asks whether pg_cron's `defaultJobOwner`
 * treatment applies here): it does NOT. `pgmq.meta` records no owner, role, or
 * database column — a queue has no identity beyond its name and its two
 * persistence flags — and `pgmq.create` takes no privileged argument, so there
 * is nothing to normalize and nothing that forces a superuser executor. That is
 * why this is a plain const handler rather than pg_cron's config FACTORY.
 *
 * PARTITIONED QUEUES ARE SCOPED OUT. `pgmq.create_partitioned(queue_name,
 * partition_interval, retention_interval)` needs two intervals that pgmq does
 * NOT store: `pgmq.meta` keeps only the `is_partitioned` flag, while the
 * intervals live in pg_partman's `part_config`. A replay derived from
 * `pgmq.meta` alone would have to guess them and could never converge, so a
 * partitioned queue emits an `INTENT_UNSUPPORTED` warning and NO fact. Its
 * operational tables are still tagged `managedBy` (they are pgmq's either way)
 * — the `q_`/`a_` parents AND every partition beneath them, discovered through
 * `pg_inherits`, so the whole family projects out TOGETHER rather than leaving
 * a partition stranded on a parent that was projected away —
 * so nothing plans a `DROP TABLE` against them. On EITHER side, a partitioned
 * queue standing alone is just unmanaged drift and the plan proceeds. The
 * diagnostic carries the queue name as its context `key` so `plan()`'s
 * collision gate can reconstruct the would-be intent id: it refuses only when
 * the OPPOSITE side manages a regular queue of the SAME name, where the skipped
 * fact would otherwise turn the transition into a bare destructive `drop_queue`
 * whose proof falsely converges (desired-side) or a no-op `create` that fails
 * the proof much later (source-side).
 *
 * NO `shadowPrecheck`: pgmq's functions work in ANY database (pg_cron's
 * single-database constraint has no pgmq analogue), which is exactly what lets
 * a declarative directory containing queue intent load into a shadow.
 */
import type { DependencyEdge, Fact, FactBase } from "../../core/fact.ts";
import { INTENT_UNSUPPORTED, type Diagnostic } from "../../core/diagnostic.ts";
import type {
  CaptureResult,
  ExtensionHandler,
  HandlerContext,
} from "../../extract/handler.ts";
import type { IntentKindRule } from "../../plan/rules.ts";
import { lit } from "../../plan/render.ts";
import type { StableId } from "../../core/stable-id.ts";

const PGMQ: StableId = { kind: "extension", name: "pgmq" };

/** Double-quote a SQL identifier (the pgmq schema is resolved dynamically). */
function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Resolve the schema pgmq is installed into, or null if absent. pgmq is
 *  non-relocatable and lands in `pgmq`, but this is resolved from the catalog
 *  (like pg_partman) rather than assumed. */
async function detect(ctx: HandlerContext): Promise<string | null> {
  const rows = await ctx.query(
    `SELECT n.nspname AS schema
       FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'pgmq'`,
  );
  return (rows[0]?.["schema"] as string | undefined) ?? null;
}

interface QueueRow {
  queue_name: string;
  is_partitioned: boolean;
  is_unlogged: boolean;
  qtable: string;
  atable: string;
}

function queueIntentId(queueName: string): StableId {
  return {
    kind: "extensionIntent",
    ext: "pgmq",
    intentKind: "queue",
    key: queueName,
  };
}

interface QueuePayload {
  isPartitioned: boolean;
  isUnlogged: boolean;
}

export const pgmqHandler: ExtensionHandler = {
  extension: "pgmq",

  async capture(
    ctx: HandlerContext,
    current: FactBase,
  ): Promise<CaptureResult> {
    const schema = await detect(ctx);
    if (schema === null) return { facts: [], edges: [] };

    // `created_at` is deliberately NOT selected: it is runtime state (when the
    // queue happened to be created), not declared intent, and including it
    // would make every queue's hash differ between two otherwise-identical
    // databases.
    //
    // The operational table names are computed by POSTGRES, mirroring pgmq's
    // own `format_table_name` (`lower(prefix || '_' || queue_name)`) — a queue
    // registered as `MixedCase` owns `pgmq.q_mixedcase`. Spelled out here
    // rather than calling `pgmq.format_table_name` so the query does not depend
    // on that internal helper existing in every pgmq version.
    const rows = (await ctx.query(
      `SELECT m.queue_name                   AS queue_name,
              m.is_partitioned               AS is_partitioned,
              m.is_unlogged                  AS is_unlogged,
              lower('q_' || m.queue_name)    AS qtable,
              lower('a_' || m.queue_name)    AS atable
         FROM ${quoteIdent(schema)}.meta m
        ORDER BY m.queue_name`,
    )) as unknown as QueueRow[];

    // A PARTITIONED queue's `q_`/`a_` relations are partitioned PARENTS whose
    // partitions are relations in their own right, so tagging only the parent
    // leaves each partition a managed fact whose parent has been projected out
    // — a stranded requirement that fails the action-graph guard on a
    // from-empty apply. Sourced from `pg_inherits` rather than guessed from
    // pg_partman's `_p<n>` / `_default` naming. One query for the whole schema;
    // empty for a database with no partitioned queue.
    const inheritsRows = (await ctx.query(
      `SELECT p.relname AS parent, c.relname AS child
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         JOIN pg_class p ON p.oid = i.inhparent
         JOIN pg_namespace pn ON pn.oid = p.relnamespace
         JOIN pg_namespace cn ON cn.oid = c.relnamespace
        WHERE pn.nspname = ${lit(schema)} AND cn.nspname = ${lit(schema)}`,
    )) as unknown as { parent: string; child: string }[];
    const childrenOf = new Map<string, string[]>();
    for (const r of inheritsRows) {
      const siblings = childrenOf.get(r.parent);
      if (siblings) siblings.push(r.child);
      else childrenOf.set(r.parent, [r.child]);
    }
    /** A table and every partition beneath it (sub-partitioning included). */
    function withDescendants(root: string): string[] {
      const out: string[] = [];
      const queue = [root];
      const seen = new Set<string>([root]);
      while (queue.length > 0) {
        const name = queue.shift()!;
        out.push(name);
        for (const child of childrenOf.get(name) ?? []) {
          if (seen.has(child)) continue; // defensive: inheritance is acyclic
          seen.add(child);
          queue.push(child);
        }
      }
      return out;
    }

    const facts: Fact[] = [];
    const edges: DependencyEdge[] = [];
    const diagnostics: Diagnostic[] = [];
    const dependsOnExtension = current.has(PGMQ);

    for (const row of rows) {
      if (row.is_partitioned) {
        diagnostics.push({
          code: INTENT_UNSUPPORTED,
          severity: "warning",
          message:
            `pgmq queue '${row.queue_name}' is PARTITIONED; its partition and ` +
            `retention intervals are not recorded in ${schema}.meta (they live in ` +
            `pg_partman's part_config), so it cannot be replayed faithfully and ` +
            `is left unmanaged`,
          // `key` is load-bearing, not decoration: plan()'s collision gate
          // rebuilds the would-be intent id from this context to look the queue
          // up in the opposite side's fact base.
          context: { ext: "pgmq", intentKind: "queue", key: row.queue_name },
        });
      } else {
        const id = queueIntentId(row.queue_name);
        facts.push({
          id,
          payload: {
            isPartitioned: row.is_partitioned,
            isUnlogged: row.is_unlogged,
          } satisfies QueuePayload,
        });
        if (dependsOnExtension) {
          edges.push({ from: id, to: PGMQ, kind: "depends" });
        }
      }

      // Phase A, for EVERY queue (partitioned or not): the `q_`/`a_` tables are
      // created operationally by `pgmq.create()`, so tag them as the
      // extension's. This keeps the handler self-contained for raw/custom
      // profiles — the Supabase policy's `pgmq` system-schema exclusion (and its
      // defensive `q_*`/`a_*` globs) stays as defense-in-depth for profile users
      // who do not compose this handler. Guarded by `current.has` so a table
      // that is not a fact never produces a dangling edge.
      //
      // Nothing else pgmq creates per queue needs tagging: the `msg_id`
      // sequence is an IDENTITY sequence (internal dependency, never its own
      // fact) and the `vt` / `archived_at` indexes are children of these
      // tables.
      //
      // For a PARTITIONED queue the family extends to each partition (see
      // `withDescendants`); for a regular one the walk yields just the table.
      for (const root of [row.qtable, row.atable]) {
        for (const name of withDescendants(root)) {
          const child: StableId = { kind: "table", schema, name };
          if (!current.has(child)) continue;
          edges.push({ from: child, to: PGMQ, kind: "managedBy" });
        }
      }
    }

    return diagnostics.length > 0
      ? { facts, edges, diagnostics }
      : { facts, edges };
  },

  intentKinds: {
    queue: {
      payloadAttrs: ["isPartitioned", "isUnlogged"],
      create(fact) {
        const key = (fact.id as Extract<StableId, { kind: "extensionIntent" }>)
          .key;
        const p = fact.payload as unknown as QueuePayload;
        // pgmq exposes persistence as two separate constructors rather than a
        // parameter, so the flag selects the function. Only non-partitioned
        // queues ever become facts (see the file header), so `pgmq.create` —
        // pgmq's documented alias for `create_non_partitioned` — is always the
        // right logged form.
        const fn = p.isUnlogged ? "create_unlogged" : "create";
        return [{ sql: `select pgmq.${fn}(${lit(key)})` }];
      },
      drop(fact) {
        const key = (fact.id as Extract<StableId, { kind: "extensionIntent" }>)
          .key;
        // DESTRUCTIVE: `drop_queue` drops the queue AND archive tables, so every
        // message still in flight (and every archived one) is destroyed. It
        // DROPs those existing relations, so it takes ACCESS EXCLUSIVE on them —
        // override the intent adapter's "none" default so the safety report
        // does not present a destructive drop as lock-free.
        return {
          sql: `select pgmq.drop_queue(${lit(key)})`,
          dataLoss: "destructive",
          lockClass: "accessExclusive",
        };
      },
    } satisfies IntentKindRule,
  },
};
