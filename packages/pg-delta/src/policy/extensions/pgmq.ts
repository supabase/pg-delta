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
 * operational tables are still tagged `managedBy` (they are pgmq's either way),
 * so nothing plans a `DROP TABLE` against them.
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
          context: { ext: "pgmq", intentKind: "queue" },
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
      for (const name of [row.qtable, row.atable]) {
        const child: StableId = { kind: "table", schema, name };
        if (!current.has(child)) continue;
        edges.push({ from: child, to: PGMQ, kind: "managedBy" });
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
