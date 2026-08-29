/**
 * pg_partman handler (docs/architecture/extension-intent.md §3.3).
 *
 * ## Phase A (Deliverable A, CLI-1555 / CLI-1591) — `managedBy` provenance
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
 *
 * ## Phase B (Deliverable B, CLI-2044) — `create_parent` intent
 *
 * Phase A alone leaves a from-scratch declarative rebuild with a BARE
 * `PARTITION BY RANGE` parent: no partman registration and no premade children,
 * because the registration is not schema DDL — `partman.create_parent(...)` is
 * a function call that writes a row to partman's own `part_config` registry.
 * So each `part_config` row is captured as an `extensionIntent` fact and
 * replayed through partman's OWN API, exactly like a pgmq queue.
 *
 * ### Key
 * `<parent_schema>.<parent_name>` taken from the CATALOG (`pg_class` /
 * `pg_namespace` via `to_regclass(parent_table)`) rather than the raw
 * `part_config.parent_table` text. partman stores whatever string the caller
 * passed and parses it with `split_part(…, '.', 1|2)`, so the stored text is
 * caller-shaped; the catalog form is canonical and therefore content-
 * addressable — two databases built by different call sites hash the same.
 * (partman's own `split_part` parsing means it never supported quoted or
 * dotted identifiers, so no quoting round-trip is lost by this choice.)
 *
 * ### `part_config` column disposition — audited against pg_partman 5.3.1
 * (the version in `supabase/postgres:17.6.1.167`). All 29 columns are
 * accounted for; adding a column in a future partman version does NOT silently
 * vanish, because `payloadAttrs` is asserted to cover every captured key.
 *
 * (a) INTENT, settable through a `create_parent()` argument — 13 columns:
 *
 *   | part_config column      | create_parent arg       | payload key            |
 *   |-------------------------|-------------------------|------------------------|
 *   | parent_table            | p_parent_table          | (the fact KEY)         |
 *   | control                 | p_control               | control                |
 *   | partition_interval      | p_interval              | partitionInterval      |
 *   | partition_type          | p_type                  | partitionType          |
 *   | epoch                   | p_epoch                 | epoch                  |
 *   | premake                 | p_premake               | premake                |
 *   | automatic_maintenance   | p_automatic_maintenance | automaticMaintenance   |
 *   | constraint_cols         | p_constraint_cols       | constraintCols         |
 *   | template_table          | p_template_table        | templateTable          |
 *   | jobmon                  | p_jobmon                | jobmon                 |
 *   | date_trunc_interval     | p_date_trunc_interval   | dateTruncInterval      |
 *   | time_encoder            | p_time_encoder          | timeEncoder            |
 *   | time_decoder            | p_time_decoder          | timeDecoder            |
 *
 * (b) INTENT, NOT reachable from any `create_parent()` argument — 11 columns.
 *     partman's documented way to set these is to UPDATE `part_config` after
 *     registration, so the replay does exactly that as a SECOND statement of
 *     the same create (emitted only when at least one differs from partman's
 *     own default, and then setting all eleven):
 *     retention, retention_schema, retention_keep_index, retention_keep_table,
 *     retention_keep_publication, optimize_constraint,
 *     infinite_time_partitions, inherit_privileges, constraint_valid,
 *     ignore_default_data, maintenance_order.
 *     They are all in the payload regardless, so a drift in one is VISIBLE
 *     (it replaces the intent) rather than silently dropped.
 *
 * (c) RUNTIME state — never captured, 5 columns:
 *     datetime_string (derived by partman from partition_interval),
 *     undo_in_progress, maintenance_last_run, async_partitioning_in_progress
 *     (all transient bookkeeping), and sub_partition_set_full (a flag partman
 *     maintains for sub-partition sets, which this slice scopes out anyway).
 *     Capturing any of them would make two otherwise-identical databases hash
 *     differently.
 *
 * `create_parent()` arguments with NO `part_config` column are, correspondingly,
 * not captured: `p_start_partition` and `p_offset_id` are one-shot boundaries
 * for the FIRST premade set (and every premade child is `managedBy`-excluded
 * anyway, so they cannot drift), and `p_control_not_null` is a pure GUARD —
 * partman raises if it is true and the control column is nullable, and never
 * mutates anything. The replay therefore always passes
 * `p_control_not_null := false`, which is correct whether or not the column is
 * NOT NULL. `p_default_table` has no column either, but IS real intent, so it
 * is recovered structurally from `pg_partitioned_table.partdefid <> 0`.
 *
 * ### `partmanSchema` in the payload
 * pg_partman is RELOCATABLE (it installs into `public` by default and Supabase
 * puts it in `partman`), and an `IntentKindRule` sees only the fact — no view on
 * `drop` — so the install schema must ride on the payload for the replay to be
 * renderable at all. It is a listed `payloadAttr`: relocating partman genuinely
 * invalidates every captured replay, so it must be visible as a change rather
 * than tripping the "extend the rule vocabulary" guard.
 *
 * ### The template table
 * `create_parent` auto-creates `<partman_schema>.template_<parent_schema>_<parent_name>`
 * when `p_template_table` is NULL. That table is NOT an extension member
 * (`pg_depend deptype='e'` is absent — verified on 5.3.1), so core extraction
 * keeps it as an ordinary fact. It is tagged `managedBy` — it is partman's, in
 * partman's own schema, exactly like pgmq's `q_*` / `a_*` tables — and the
 * payload records `templateTable: null` so the replay omits the argument and
 * lets partman recreate it. A USER-supplied template table (any other name) is
 * left as a user fact, carried in the payload, and `consumes`d by the replay so
 * `create_parent` runs after its `CREATE TABLE` (partman ERRORS on a missing
 * template rather than creating one, so the loader's retry rounds also converge).
 * Known gap: customizations made to the AUTO-created template table are not
 * captured — supply your own template table if you need them.
 *
 * ### Sub-partitioning is scoped OUT
 * `create_sub_parent()` records a `part_config_sub` row on the top parent and a
 * `part_config` row on every child that becomes a sub-parent. Replaying those
 * child rows as `create_parent` would be wrong (partman, not the user, created
 * them), and replaying the top parent as `create_parent` would silently lose the
 * sub-level. Both cases emit an `INTENT_UNSUPPORTED` warning and NO fact,
 * mirroring pgmq's partitioned-queue scope-out. Their partitions stay tagged
 * `managedBy` either way — the Phase-A walk is recursive, so it already covers
 * every sub-level — so nothing plans a `DROP TABLE` against them.
 *
 * ### pgmq-owned parents are scoped OUT
 * `pgmq.create_partitioned(q)` creates `pgmq.q_<q>` / `pgmq.a_<q>` as its own
 * tables and registers BOTH in `part_config`. Replaying those as `create_parent`
 * is wrong twice over: the replay would `consume` a table nothing in the plan
 * creates (the pgmq handler deliberately emits no fact for a partitioned queue,
 * and the Supabase profile projects the whole `pgmq` schema out), so an
 * export / from-empty load cannot apply; and a live↔live diff whose desired side
 * lacks the queue would plan `DELETE FROM part_config` against a live database,
 * silently disabling pgmq's own partition maintenance. Both rows therefore emit
 * an `INTENT_UNSUPPORTED` warning and NO fact, exactly like the sub-partition
 * case. Phase A is deliberately NOT restricted, so the queue's partitions stay
 * tagged `managedBy` and nothing plans a `DROP TABLE` against them.
 *
 * ### `drop` deregisters; it does not destroy
 * There is no single-statement inverse of `create_parent`: `undo_partition()`
 * requires a separate `p_target_table` to move rows into and is batched by
 * `p_loop_count` (verified on 5.3.1), so it cannot be a replay. The drop is
 * therefore the minimal honest one — `DELETE FROM part_config` — which removes
 * exactly the captured intent and destroys nothing. Its consequence is
 * deliberate and documented: the partitions and the template table lose their
 * `managedBy` tag and become ORDINARY user tables, so a second sync round sees
 * them explicitly and drops them under the normal data-loss gate. That is
 * preferable to hiding a mass `DROP TABLE` inside an opaque replay. See the
 * CLI-2044 triage in docs/roadmap/pg-delta-next-follow-ups.md.
 *
 * NO `shadowPrecheck`: partman's functions work in ANY database (pg_cron's
 * single-database constraint has no partman analogue), which is what lets a
 * declarative directory containing parent intent load into a shadow.
 */
import type { DependencyEdge, Fact, FactBase } from "../../core/fact.ts";
import { INTENT_UNSUPPORTED, type Diagnostic } from "../../core/diagnostic.ts";
import type {
  CaptureResult,
  ExtensionHandler,
  HandlerContext,
} from "../../extract/handler.ts";
import type { ActionSpec, IntentKindRule } from "../../plan/rules.ts";
import { lit, qid } from "../../plan/render.ts";
import type { StableId } from "../../core/stable-id.ts";

const PG_PARTMAN: StableId = { kind: "extension", name: "pg_partman" };

/** Double-quote a SQL identifier (the partman schema is dynamic). */
function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Resolve the schema `extname` is installed into, or null if absent. Used for
 *  pg_partman itself and — see the pgmq scope-out below — for pgmq. */
async function extensionSchema(
  ctx: HandlerContext,
  extname: string,
): Promise<string | null> {
  const rows = await ctx.query(
    `SELECT n.nspname AS schema
       FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = ${lit(extname)}`,
  );
  return (rows[0]?.["schema"] as string | undefined) ?? null;
}

/** A schema-qualified relation reference carried on a payload. The index
 *  signature is what makes it assignable to `PayloadValue`'s object arm (so the
 *  content hash canonicalises it like any other nested payload object). */
interface RelRef {
  [key: string]: string;
  schema: string;
  name: string;
}

/** One `part_config` row as the capture query projects it (see the disposition
 *  table in the file header — every column is either here or deliberately
 *  runtime state). */
interface ConfigRow {
  parent_schema: string;
  parent_name: string;
  control: string;
  partition_interval: string;
  partition_type: string;
  epoch: string;
  premake: number;
  automatic_maintenance: string;
  constraint_cols: string[] | null;
  template_schema: string | null;
  template_name: string | null;
  jobmon: boolean;
  date_trunc_interval: string | null;
  time_encoder: string | null;
  time_decoder: string | null;
  default_table: boolean;
  retention: string | null;
  retention_schema: string | null;
  retention_keep_index: boolean;
  retention_keep_table: boolean;
  retention_keep_publication: boolean;
  optimize_constraint: number;
  infinite_time_partitions: boolean;
  inherit_privileges: boolean;
  constraint_valid: boolean;
  ignore_default_data: boolean;
  maintenance_order: number | null;
  is_sub_partition_set: boolean;
  is_sub_partition_child: boolean;
  is_pgmq_queue: boolean;
}

/** The captured intent of one registered parent. Split (a) / (b) exactly as the
 *  file header's disposition table: the first block replays as `create_parent`
 *  arguments, the second as the follow-up `UPDATE part_config`. */
interface ParentPayload {
  /** the schema pg_partman is installed into — see the header */
  partmanSchema: string;
  // (a) create_parent() arguments
  control: string;
  partitionInterval: string;
  partitionType: string;
  epoch: string;
  premake: number;
  automaticMaintenance: string;
  constraintCols: string[] | null;
  /** null = partman's auto-created template table (the replay omits the arg) */
  templateTable: RelRef | null;
  jobmon: boolean;
  dateTruncInterval: string | null;
  timeEncoder: string | null;
  timeDecoder: string | null;
  defaultTable: boolean;
  // (b) post-registration part_config settings
  retention: string | null;
  retentionSchema: string | null;
  retentionKeepIndex: boolean;
  retentionKeepTable: boolean;
  retentionKeepPublication: boolean;
  optimizeConstraint: number;
  infiniteTimePartitions: boolean;
  inheritPrivileges: boolean;
  constraintValid: boolean;
  ignoreDefaultData: boolean;
  maintenanceOrder: number | null;
}

/** Every payload key, in declaration order — the rule's `payloadAttrs`. A key
 *  missing here would make its drift trip the planner's "extend the rule
 *  vocabulary" guard, so this list and {@link ParentPayload} are kept in step by
 *  a unit test. */
const PARENT_PAYLOAD_ATTRS = [
  "partmanSchema",
  "control",
  "partitionInterval",
  "partitionType",
  "epoch",
  "premake",
  "automaticMaintenance",
  "constraintCols",
  "templateTable",
  "jobmon",
  "dateTruncInterval",
  "timeEncoder",
  "timeDecoder",
  "defaultTable",
  "retention",
  "retentionSchema",
  "retentionKeepIndex",
  "retentionKeepTable",
  "retentionKeepPublication",
  "optimizeConstraint",
  "infiniteTimePartitions",
  "inheritPrivileges",
  "constraintValid",
  "ignoreDefaultData",
  "maintenanceOrder",
] as const;

/** pg_partman 5.3.1's own column defaults for the (b) block. The follow-up
 *  `UPDATE part_config` is emitted only when the captured intent differs from
 *  ALL of these — a fresh `create_parent` already leaves exactly this state. */
const PARTMAN_DEFAULTS = {
  retention: null,
  retentionSchema: null,
  retentionKeepIndex: true,
  retentionKeepTable: true,
  retentionKeepPublication: false,
  optimizeConstraint: 30,
  infiniteTimePartitions: false,
  inheritPrivileges: false,
  constraintValid: true,
  ignoreDefaultData: true,
  maintenanceOrder: null,
} as const;

function parentIntentId(key: string): StableId {
  return {
    kind: "extensionIntent",
    ext: "pg_partman",
    intentKind: "parent",
    key,
  };
}

/** partman names its auto-created template table `template_<schema>_<name>` in
 *  its own install schema. Postgres truncates the identifier at 63 bytes, which
 *  the comparison mirrors. A false negative is SAFE: the table is then treated
 *  as user-supplied — exported and consumed — which still replays correctly. */
function isAutoTemplate(
  row: ConfigRow,
  partmanSchema: string,
  templateSchema: string,
  templateName: string,
): boolean {
  if (templateSchema !== partmanSchema) return false;
  const auto = `template_${row.parent_schema}_${row.parent_name}`;
  return templateName === auto || templateName === auto.slice(0, 63);
}

/** The literal for a `text` argument that may be NULL. */
function textArg(value: string | null): string {
  return value === null ? "NULL" : lit(value);
}

/** The literal for a `text[]` argument that may be NULL. */
function textArrayArg(value: string[] | null): string {
  if (value === null) return "NULL";
  return `ARRAY[${value.map(lit).join(", ")}]::text[]`;
}

/** The literal for an `integer` argument that may be NULL. */
function intArg(value: number | null): string {
  return value === null ? "NULL" : String(value);
}

/** Split an intent key (`<schema>.<name>`, produced from the catalog by
 *  capture) back into its parts, so the replay can name the parent table both
 *  as partman's `text` argument and as a consumed `StableId`. */
function parentRef(key: string): RelRef {
  const dot = key.indexOf(".");
  return { schema: key.slice(0, dot), name: key.slice(dot + 1) };
}

export const pgPartmanHandler: ExtensionHandler = {
  extension: "pg_partman",

  async capture(
    ctx: HandlerContext,
    current: FactBase,
  ): Promise<CaptureResult> {
    const schema = await extensionSchema(ctx, "pg_partman");
    if (schema === null) return { facts: [], edges: [] };
    const pgmqSchema = await extensionSchema(ctx, "pgmq");

    const facts: Fact[] = [];
    const edges: DependencyEdge[] = [];
    const diagnostics: Diagnostic[] = [];

    // ── Phase A: every table inheriting (directly or transitively) from a
    //    parent registered in part_config is partman-managed. ───────────────
    const children = await ctx.query(
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

    for (const row of children) {
      const child: StableId = {
        kind: "table",
        schema: String(row["schema"]),
        name: String(row["name"]),
      };
      // only tag children that are actually facts (avoid dangling edges)
      if (!current.has(child)) continue;
      edges.push({ from: child, to: PG_PARTMAN, kind: "managedBy" });
    }

    // ── Phase B: each part_config row is one replayable `create_parent`. ────
    // The parent is resolved through the CATALOG (`to_regclass`), which both
    // canonicalises the key and drops rows whose table no longer exists.
    // `default_table` comes from `pg_partitioned_table.partdefid` — the only
    // structural record of `p_default_table`, which partman does not store.
    // The two sub-partition flags mark rows this slice cannot replay.
    //
    // `is_pgmq_queue` marks the OTHER unreplayable shape: a queue table
    // `pgmq.create_partitioned(...)` registered for itself (see the header).
    // It has to come from the CATALOG — pgmq's own registry — because neither
    // cheaper signal exists at capture time:
    //   * fact presence: handlers run at the END of `extract()` on the RAW,
    //     unfiltered fact base; the Supabase profile's `pgmq` system-schema
    //     projection happens later, in `plan()`. `current.has(q_x)` is TRUE here.
    //   * a cross-handler `managedBy` edge: handlers run sequentially and each
    //     one is handed the PRE-handler fact base, so pgmq's edges are invisible.
    // The name test mirrors pgmq's `format_table_name`
    // (`lower(prefix || '_' || queue_name)`), spelled out rather than calling
    // that internal helper so it does not depend on a particular pgmq version,
    // and referencing only `meta.queue_name`, which every version has. BOTH
    // prefixes are covered: `create_partitioned` registers the `q_` queue table
    // AND its `a_` archive table (verified on pgmq 1.5.1).
    const isPgmqQueue =
      pgmqSchema === null
        ? "false"
        : `(pn.nspname = ${lit(pgmqSchema)} AND EXISTS (
                  SELECT 1 FROM ${quoteIdent(pgmqSchema)}.meta m
                   WHERE pc_rel.relname IN (lower('q_' || m.queue_name),
                                            lower('a_' || m.queue_name))
                ))`;
    const configs = (await ctx.query(
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
       SELECT pn.nspname                        AS parent_schema,
              pc_rel.relname                    AS parent_name,
              pc.control                        AS control,
              pc.partition_interval             AS partition_interval,
              pc.partition_type                 AS partition_type,
              pc.epoch                          AS epoch,
              pc.premake                        AS premake,
              pc.automatic_maintenance          AS automatic_maintenance,
              pc.constraint_cols                AS constraint_cols,
              tn.nspname                        AS template_schema,
              t_rel.relname                     AS template_name,
              pc.jobmon                         AS jobmon,
              pc.date_trunc_interval            AS date_trunc_interval,
              pc.time_encoder                   AS time_encoder,
              pc.time_decoder                   AS time_decoder,
              COALESCE(pt.partdefid, 0) <> 0    AS default_table,
              pc.retention                      AS retention,
              pc.retention_schema               AS retention_schema,
              pc.retention_keep_index           AS retention_keep_index,
              pc.retention_keep_table           AS retention_keep_table,
              pc.retention_keep_publication     AS retention_keep_publication,
              pc.optimize_constraint            AS optimize_constraint,
              pc.infinite_time_partitions       AS infinite_time_partitions,
              pc.inherit_privileges             AS inherit_privileges,
              pc.constraint_valid               AS constraint_valid,
              pc.ignore_default_data            AS ignore_default_data,
              pc.maintenance_order              AS maintenance_order,
              ${isPgmqQueue}                    AS is_pgmq_queue,
              EXISTS (
                SELECT 1 FROM ${quoteIdent(schema)}.part_config_sub s
                 WHERE s.sub_parent = pc.parent_table
              )                                 AS is_sub_partition_set,
              EXISTS (
                SELECT 1 FROM descendants d WHERE d.oid = pc_rel.oid
              )                                 AS is_sub_partition_child
         FROM ${quoteIdent(schema)}.part_config pc
         JOIN pg_class pc_rel ON pc_rel.oid = to_regclass(pc.parent_table)
         JOIN pg_namespace pn ON pn.oid = pc_rel.relnamespace
         LEFT JOIN pg_partitioned_table pt ON pt.partrelid = pc_rel.oid
         LEFT JOIN pg_class t_rel ON t_rel.oid = to_regclass(pc.template_table)
         LEFT JOIN pg_namespace tn ON tn.oid = t_rel.relnamespace
        ORDER BY pn.nspname, pc_rel.relname`,
    )) as unknown as ConfigRow[];

    const dependsOnExtension = current.has(PG_PARTMAN);

    for (const row of configs) {
      const key = `${row.parent_schema}.${row.parent_name}`;

      // pgmq's, not the user's — skipped BEFORE the template handling below so
      // the row leaks no fact and no edge at all.
      if (row.is_pgmq_queue) {
        diagnostics.push({
          code: INTENT_UNSUPPORTED,
          severity: "warning",
          message:
            `pg_partman parent '${key}' is a pgmq-managed queue table registered ` +
            `by pgmq.create_partitioned(), so replaying it through create_parent() ` +
            `cannot converge: the queue table is extension-managed rather than ` +
            `user DDL, and pgmq itself captures no intent for a partitioned ` +
            `queue. Its registration is left unmanaged (never deregistered) and ` +
            `its partitions stay tagged managedBy; cross-handler replay of ` +
            `partitioned queues is a recorded follow-up`,
          // `key` is the collision-gate contract (same as the sub-partition
          // skip below): a keyless diagnostic would hit plan()'s conservative
          // fallback and refuse the whole plan; with the key, both sides skip
          // the same row so no collision forms and this stays a warning.
          context: { ext: "pg_partman", intentKind: "parent", key },
        });
        continue;
      }

      if (row.is_sub_partition_set || row.is_sub_partition_child) {
        diagnostics.push({
          code: INTENT_UNSUPPORTED,
          severity: "warning",
          message:
            `pg_partman parent '${key}' belongs to a SUB-PARTITIONED set, which ` +
            `create_parent() alone cannot replay (create_sub_parent registers a ` +
            `${schema}.part_config_sub row and a part_config row per sub-parent), ` +
            `so its registration is left unmanaged; its partitions are still ` +
            `tagged managedBy and are never dropped`,
          // `key` is the collision-gate contract (see plan()'s unsupported-
          // intent gate): it lets a same-key collision with a fact on the
          // opposite side refuse the plan while a standalone sub-partitioned
          // set stays a non-blocking warning.
          context: { ext: "pg_partman", intentKind: "parent", key },
        });
        continue;
      }

      // A template table partman created for itself is partman's, and the
      // replay recreates it — tag it and record `null` (the omitted argument).
      // Anything else is the user's: it stays a fact and rides on the payload.
      let templateTable: RelRef | null = null;
      if (row.template_schema !== null && row.template_name !== null) {
        if (
          isAutoTemplate(row, schema, row.template_schema, row.template_name)
        ) {
          const tpl: StableId = {
            kind: "table",
            schema: row.template_schema,
            name: row.template_name,
          };
          if (current.has(tpl)) {
            edges.push({ from: tpl, to: PG_PARTMAN, kind: "managedBy" });
          }
        } else {
          templateTable = {
            schema: row.template_schema,
            name: row.template_name,
          };
        }
      }

      const id = parentIntentId(key);
      facts.push({
        id,
        payload: {
          partmanSchema: schema,
          control: row.control,
          partitionInterval: row.partition_interval,
          partitionType: row.partition_type,
          epoch: row.epoch,
          premake: row.premake,
          automaticMaintenance: row.automatic_maintenance,
          constraintCols: row.constraint_cols,
          templateTable,
          jobmon: row.jobmon,
          dateTruncInterval: row.date_trunc_interval,
          timeEncoder: row.time_encoder,
          timeDecoder: row.time_decoder,
          defaultTable: row.default_table,
          retention: row.retention,
          retentionSchema: row.retention_schema,
          retentionKeepIndex: row.retention_keep_index,
          retentionKeepTable: row.retention_keep_table,
          retentionKeepPublication: row.retention_keep_publication,
          optimizeConstraint: row.optimize_constraint,
          infiniteTimePartitions: row.infinite_time_partitions,
          inheritPrivileges: row.inherit_privileges,
          constraintValid: row.constraint_valid,
          ignoreDefaultData: row.ignore_default_data,
          maintenanceOrder: row.maintenance_order,
        } satisfies ParentPayload,
      });
      if (dependsOnExtension) {
        edges.push({ from: id, to: PG_PARTMAN, kind: "depends" });
      }
    }

    return diagnostics.length > 0
      ? { facts, edges, diagnostics }
      : { facts, edges };
  },

  intentKinds: {
    parent: {
      payloadAttrs: PARENT_PAYLOAD_ATTRS,
      create(fact) {
        const key = (fact.id as Extract<StableId, { kind: "extensionIntent" }>)
          .key;
        const p = fact.payload as unknown as ParentPayload;
        const s = quoteIdent(p.partmanSchema);
        const parent = parentRef(key);

        // `p_control_not_null := false` unconditionally: it is a GUARD, never a
        // mutation (partman raises when it is true and the control column is
        // nullable), so passing false is correct either way and keeps the
        // parent's column nullability out of this payload.
        const args = [
          `p_parent_table := ${lit(key)}`,
          `p_control := ${lit(p.control)}`,
          `p_interval := ${lit(p.partitionInterval)}`,
          `p_type := ${lit(p.partitionType)}`,
          `p_epoch := ${lit(p.epoch)}`,
          `p_premake := ${p.premake}`,
          `p_default_table := ${p.defaultTable}`,
          `p_automatic_maintenance := ${lit(p.automaticMaintenance)}`,
          `p_constraint_cols := ${textArrayArg(p.constraintCols)}`,
          `p_jobmon := ${p.jobmon}`,
          `p_date_trunc_interval := ${textArg(p.dateTruncInterval)}`,
          `p_control_not_null := false`,
          `p_time_encoder := ${textArg(p.timeEncoder)}`,
          `p_time_decoder := ${textArg(p.timeDecoder)}`,
        ];
        // The parent table must exist first; a user-supplied template table too
        // (partman raises "Unable to find given template table" rather than
        // creating one). partman's auto-created template needs no argument.
        // Every argument is NAMED, so appending is order-independent.
        const consumes: StableId[] = [
          { kind: "table", schema: parent.schema, name: parent.name },
        ];
        if (p.templateTable !== null) {
          args.push(
            `p_template_table := ${lit(
              `${p.templateTable.schema}.${p.templateTable.name}`,
            )}`,
          );
          consumes.push({
            kind: "table",
            schema: p.templateTable.schema,
            name: p.templateTable.name,
          });
        }

        const specs: ActionSpec[] = [
          {
            sql: `select ${s}.create_parent(${args.join(", ")})`,
            consumes,
            // create_parent takes it EXPLICITLY on the parent —
            // `LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE`, the only such LOCK in
            // pg_partman--5.3.1.sql's create_parent body (line 1348) — so the
            // intent-rule default of "none" would under-report the plan's
            // strongest lock. (Its ATTACH PARTITIONs are weaker; this dominates.)
            lockClass: "accessExclusive",
          },
        ];

        // (b) settings have no create_parent argument; partman's documented way
        // to set them is to UPDATE part_config after registration. Emitted only
        // when the intent differs from what create_parent already leaves behind.
        const settings: Array<[string, string]> = [
          ["retention", textArg(p.retention)],
          ["retention_schema", textArg(p.retentionSchema)],
          ["retention_keep_index", String(p.retentionKeepIndex)],
          ["retention_keep_table", String(p.retentionKeepTable)],
          ["retention_keep_publication", String(p.retentionKeepPublication)],
          ["optimize_constraint", String(p.optimizeConstraint)],
          ["infinite_time_partitions", String(p.infiniteTimePartitions)],
          ["inherit_privileges", String(p.inheritPrivileges)],
          ["constraint_valid", String(p.constraintValid)],
          ["ignore_default_data", String(p.ignoreDefaultData)],
          ["maintenance_order", intArg(p.maintenanceOrder)],
        ];
        const atDefaults =
          p.retention === PARTMAN_DEFAULTS.retention &&
          p.retentionSchema === PARTMAN_DEFAULTS.retentionSchema &&
          p.retentionKeepIndex === PARTMAN_DEFAULTS.retentionKeepIndex &&
          p.retentionKeepTable === PARTMAN_DEFAULTS.retentionKeepTable &&
          p.retentionKeepPublication ===
            PARTMAN_DEFAULTS.retentionKeepPublication &&
          p.optimizeConstraint === PARTMAN_DEFAULTS.optimizeConstraint &&
          p.infiniteTimePartitions ===
            PARTMAN_DEFAULTS.infiniteTimePartitions &&
          p.inheritPrivileges === PARTMAN_DEFAULTS.inheritPrivileges &&
          p.constraintValid === PARTMAN_DEFAULTS.constraintValid &&
          p.ignoreDefaultData === PARTMAN_DEFAULTS.ignoreDefaultData &&
          p.maintenanceOrder === PARTMAN_DEFAULTS.maintenanceOrder;
        if (!atDefaults) {
          specs.push({
            sql:
              `update ${s}.part_config set ` +
              settings
                .map(([col, value]) => `${qid(col)} = ${value}`)
                .join(", ") +
              ` where ${qid("parent_table")} = ${lit(key)}`,
          });
        }

        return specs;
      },
      drop(fact) {
        const key = (fact.id as Extract<StableId, { kind: "extensionIntent" }>)
          .key;
        const p = fact.payload as unknown as ParentPayload;
        // NON-destructive by construction: deregistering removes exactly the
        // captured intent. The partitions and template table survive as
        // ordinary user tables — see the header for why that beats an opaque
        // mass DROP TABLE.
        return {
          sql:
            `delete from ${quoteIdent(p.partmanSchema)}.part_config ` +
            `where ${qid("parent_table")} = ${lit(key)}`,
          dataLoss: "none",
        };
      },
    } satisfies IntentKindRule,
  },
};
