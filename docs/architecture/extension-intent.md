# Extension intent: diffing stateful extensions (pgmq, pg_cron, pg_partman)

- **Status**: Feature design — extends `target-architecture.md`; does **not**
  amend its invariants. Implements the substrate that the Linear triage (see
  [the build log](../build-log.md)) identified as the one genuine design gap.
- **Date**: 2026-06-13 (rev. b — optimized to a single fact base; see §10c)
- **Relates to**: CLI-1385 (parent RFC), CLI-1591 / CLI-1555 (pg_partman),
  CLI-341 (pg_cron), CLI-1430 (per-extension intent matrix), CLI-1431
  (declarative source format), CLI-1434 (vault), CLI-1435 (pg_cron ownership),
  CLI-1433 (pg_net).
- **Baseline**: the clean-room engine @ `feat/pg-delta-next`, commit `2a91580`
  (before promotion to `packages/pg-delta`).
- **Shipped**: Phase A (filter / no data loss). Phase B (intent replay) is
  designed and blocked — see
  [../roadmap/extension-intent-phase-b.md](../roadmap/extension-intent-phase-b.md).

> **One sentence.** Stateful extensions own catalog state the schema diff must
> neither destroy nor re-derive — pgmq queues, pg_cron schedules, pg_partman
> parents. This design captures that state as **ordinary facts in the one fact
> base** (produced by the integration layer, not core; provenance-tagged so the
> core schema contract stays pure), filters the operational objects the
> extension created out of the diff, and replays intent through the **extension's
> own API** ordered by the **same one graph and proven by the same proof loop**
> as schema actions — adding no second pipeline and amending none of the
> north-star invariants.

---

## 1. The problem, and the boundary it must respect

`supabase db schema declarative sync` (and branch rebuilds) emit `DROP TABLE`
for every child partition pg_partman created, drop pgmq queue tables, and never
recreate cron schedules — because the schema diff sees operationally-created
objects as drift and sees nothing to recreate them from. The three use cases:

- **pgmq** — `pgmq.create('jobs')` builds `pgmq.q_jobs` / `pgmq.a_jobs` tables +
  indexes at runtime. A diff drops them (loses queued messages); a rebuild
  yields a project with no queues.
- **pg_cron** — `cron.schedule('nightly','0 0 * * *','...')` inserts a `cron.job`
  row. A diff never captures it (the `cron` schema is filtered as managed); a
  rebuilt branch has no scheduled jobs.
- **pg_partman** — `partman.create_parent('public.events', ...)` registers
  `part_config` and premakes children. A diff drops the children (data loss); a
  rebuild yields a bare parent with no partitioning and no config.

### The hard line: intent, not data

`target-architecture.md` §1 makes data migration (DML) **permanently out of
scope**, and that does not change. The unit captured is **intent** — the
*structural declaration* the user made — never the operational payload:

| Extension | **Intent** (captured) | **Data / runtime** (never captured) |
|---|---|---|
| pgmq | the set of queues; each queue's type (standard / unlogged / partitioned) + partition settings | queue messages (`q_*` rows), archive (`a_*` rows), visibility/read counters |
| pg_cron | the set of jobs: `jobname`, `schedule`, `command`, `database`, `username`, `active` | `cron.job_run_details` (run history) |
| pg_partman | `part_config` reduced to its **intent columns** (control, partition type/interval, premake, retention, template, automatic_maintenance, …) + `part_config_sub` | which children currently exist, `last_partition`, rows inside partitions |
| supabase_vault | **presence only** (extension enabled?) — see [vault.md](./vault.md) | `vault.secrets` — never read (CLI-1434) |

Three consequences, load-bearing for the rest of the design:

1. **Operational objects are filtered, not diffed.** partman children, pgmq
   `q_*`/`a_*` tables — the extension owns their lifecycle, so the schema diff
   excludes them (Deliverable A, §4.3).
2. **Intent is replayed through the extension's own API**, not as
   reverse-engineered DDL. We emit `pgmq.create(...)`, `cron.schedule(...)`,
   `partman.create_parent(...)` — the declarations. Synthesizing the raw
   `CREATE TABLE pgmq.q_jobs (...)` the extension produces would **reimplement
   the extension**, which is version-fragile and violates P1 (§2).
3. **Row data is preserved, never moved.** The data-preservation proof (§6)
   asserts messages and partition rows survive any plan that does not *intend*
   to drop the queue/parent. We never copy rows; we only refuse to destroy them.

---

## 2. Principles (the north-star principles, applied to intent)

No new philosophy — the existing two principles applied to a second kind of
state.

### P1 applied — capture and replay, never parse, never reimplement

The deepest bug source is reimplementing PostgreSQL (or extension) semantics.
Intent is no exception, in **both** directions:

- **Reading**: intent is *captured* from the extension's own catalogs
  (`part_config`, `cron.job`, pgmq's `meta`) exactly as schema is read from
  `pg_catalog`. We never parse a `cron.command`, an install script, or a
  migration to *infer* intent. A `cron.command` we cannot introspect is treated
  like a PL/pgSQL body — opaque, late-bound, ordered conservatively (§4.5).
- **Writing**: intent is *replayed* through the extension's own function. The
  extension is the authoritative elaborator of its own objects — so replaying
  `pgmq.create` is the same P1 move as letting Postgres elaborate a `CREATE
  TABLE`, while emitting hand-built DDL for `pgmq.q_jobs` would be a private,
  version-coupled reimplementation.

### P2 applied — intent knowledge in exactly two forms

Per-extension knowledge lives in exactly two forms, mirroring the rule table:

1. **Capture queries** — extension catalog → normalized facts + edges.
2. **Intent rules** — intent-deltas → replay actions, with `consumes` /
   `produces` / safety metadata, registered into the **one** rule table.

Everything between (diff, ordering, proof, rename, safety) is the **same generic
machinery** the schema path uses. Supporting a new stateful extension means
writing one **handler** (a data package) and authoring zero engine code.

### One fact base — "sidecar" is a contract, not a second pipeline

Two things must both hold, and they are **not** a trade-off (the earlier draft
treated them as one — §10c):

- **The core schema contract stays pure.** `src/core` extracts `pg_catalog` and
  nothing else (P1, project `CLAUDE.md`); it never learns what a queue is.
- **There is exactly one fact model, one diff, one graph, one proof.** A
  *second* fact relation with its own capture/diff/proof would reintroduce the
  grain translation that §8.7 exists to eliminate (guardrail 8).

The resolution: intent facts are **ordinary facts in the one fact base** — same
`Fact` shape, identity-free content hash, Merkle rollup, generic `Delta`,
one-graph sort, proof loop, rename machinery — but **produced by the integration
layer, not by core extraction**, and carrying **provenance** that excludes them
from the core schema contract. "Sidecar" means *who produces the fact and which
contract governs it*, not a separate structure. Core extraction reads
`pg_catalog`; an **integration-aware extract** additionally runs the registered
handler captures **under the same exported snapshot**; both fact streams land in
one fact base. Nothing downstream is duplicated, and §1/P1 hold because *core*
still produces only schema.

---

## 3. What is captured per extension (the intent matrix, v1)

An intent fact is identity-keyed and content-hashed exactly like a schema fact
(`target-architecture.md` §3.1): identity-free payload, so hash-equality drives
diff and rename. Identity uses a **single generic core kind**,
`extensionIntent`, parameterized by `ext` + `intentKind` + key — so the core
StableId codec gains *one* kind, not one per extension (guardrail 1 stays a
single codec).

```ts
// canonical id: extensionIntent:{ ext, intentKind, key }
//   e.g. extensionIntent:{ ext:"pgmq", intentKind:"queue", key:"jobs" }
```

### 3.1 pgmq

```ts
{ ext:"pgmq", intentKind:"queue", key:<name>,
  payload: { type:"standard"|"unlogged"|"partitioned",
             partition_interval?:string, retention_interval?:string } }
```

- **Capture**: read pgmq's queue registry (`<pgmq_schema>.meta` /
  `pgmq.list_queues()`), schema resolved dynamically via
  `pg_extension`/`pg_namespace`.
- **Create**: `select pgmq.create('<name>')` / `create_unlogged` /
  `create_partitioned`. **Drop**: `pgmq.drop_queue('<name>')` —
  `dataLoss:"destructive"`.
- **Operational objects** (filtered, §4.3): `pgmq.q_<name>`, `pgmq.a_<name>`,
  their indexes/sequences.
- **consumes**: none. **produces**: the queue intent fact + (via `managedBy`
  edges) its operational objects.

### 3.2 pg_cron

```ts
{ ext:"pg_cron", intentKind:"job", key:<jobname>,
  payload: { schedule:string, command:string /* opaque */,
             database:string, username:string, active:boolean } }
```

The handler is a **factory** — `makePgCronHandler({ defaultJobOwner,
jobOwnerAliases })` — so `pg-cron.ts` names no platform roles; the Supabase
profile (`src/integrations/supabase.ts`) supplies both, sourcing
`defaultJobOwner` from `supabasePolicy.defaultOwner`. A **custom profile file**
(`--profile ./p.json`) names handlers as strings, and the CLI resolves each name
through a factory registry (`src/cli/profile.ts`) that passes the file's own
declared `policy` — so `handlers: ["pg_cron"]` derives `defaultJobOwner` from
that file's `policy.defaultOwner` too. `jobOwnerAliases` stays Supabase-only:
it is platform history, not something a policy can express.

- **Capture**: read `cron.job`. **Ownership normalization (CLI-1435)**: jobs
  created before the patch were owned by `supabase_read_only_user`; the
  profile's `jobOwnerAliases` rewrites `username` to `postgres` on capture so a
  rebuild doesn't reproduce the legacy owner. Declared once, in the profile.
  A job owned by a role OTHER than `defaultJobOwner` also raises an
  `intent-privileged` **warning** (warn + emit — its reconstruction genuinely
  needs a superuser connection; see Create).
- **Create**: `select cron.schedule_in_database('<jobname>','<schedule>',
  '<command>','<database>',<username>,<active>)` — all captured fields replayed
  (the 3-arg `cron.schedule` form always creates the job in the current
  database, active, owned by the caller, so it cannot converge).
  **Username elision**: pg_cron rejects a non-NULL `username` argument unless
  the caller is SUPERUSER — *even when it names the calling role itself*
  ("must be superuser to create a job for another role") — while a bare `NULL`
  means `current_user` and needs no privilege. A profile declaring a
  `defaultJobOwner` is also declaring who executes the plan, so a job owned by
  that role renders `NULL` and stays applyable by the non-superuser `postgres`
  a hosted Supabase project hands out. Any other owner keeps the explicit
  literal. With no `defaultJobOwner` (the `raw` profile, or a profile file that
  declares no `policy.defaultOwner`) nothing is elided.
- **Change** (`schedule`/`command`/`active`/`database`): **`unschedule` +
  re-`schedule` by name** — fully static and deterministic; no apply-time
  `job_id` resolution. Run history isn't contracted, so recreate is lossless
  w.r.t. our contract. (`cron.alter_job` is avoided precisely because it needs a
  runtime id.)
- **Drop**: `cron.unschedule('<jobname>')` — `dataLoss:"none"`.
- **consumes**: the `command` may reference user objects but is **opaque** (P1:
  not parsed) and **late-bound at run time** — ordered conservatively last
  (§4.5). **produces**: the job intent fact.

### 3.3 pg_partman

```ts
{ ext:"pg_partman", intentKind:"parent", key:<schema.table>,
  payload: { control:string, partition_type:"range"|"list"|"hash"|"native",
             partition_interval:string, premake:number, retention?:string,
             retention_keep_table?:boolean, template_table?:string,
             automatic_maintenance?:"on"|"off" } }
// + extensionIntent:{ ext:"pg_partman", intentKind:"parent_sub", ... } from part_config_sub
```

- **Capture**: resolve partman's schema dynamically, read `part_config` (+
  `part_config_sub`), reduce to the **intent subset** of its ~40 columns
  (CLI-1430 owns the authoritative column→intent mapping; the sketch is the v1
  cut). Runtime columns (`last_partition`, premade-children state) are **excluded
  from the hashed payload** — they drift legitimately, like extension `version`
  (§3.1 per-kind equality surface).
- **Create**: `select partman.create_parent(p_parent_table=>'...',
  p_control=>'...', p_interval=>'...', ...)` + a `set_part_config`-style
  follow-up for retention/template/maintenance. **Drop**:
  `partman.undo_partition(...)` / unregister — `dataLoss` per
  `retention_keep_table` (conservatively `destructive` unless retention
  guarantees survival).
- **Operational objects** (filtered, §4.3): children whose `pg_inherits` parent
  ∈ `part_config` (incl. `*_default` and premade). **This is the authoritative
  signal**; `relispartition` and `pg_depend` are both insufficient — a partman
  child carries no extension dependency and is indistinguishable from a
  user-declared `PARTITION OF` by `relispartition` alone (CLI-1591).
- **consumes**: the parent table `public.events` (a normal schema fact) → ordered
  after `CREATE TABLE` + columns/PK. **produces**: the parent intent fact + (via
  `managedBy`) its operational children.

#### 3.3.1 As built (CLI-2044), and where it deviates from the sketch above

The sketch above predates the implementation. `src/policy/extensions/pg-partman.ts`
is authoritative; its header carries the **full `part_config` column
disposition table**, audited against **pg_partman 5.3.1** (the version shipped
in `supabase/postgres:17.6.1.135`). All 29 columns of 5.3.1 are classified:

| class | count | what it is | how it replays |
|---|---|---|---|
| (a) | 13 | intent reachable from a `create_parent()` argument | rendered as that named argument |
| (b) | 11 | intent with **no** `create_parent()` argument (`retention*`, `optimize_constraint`, `infinite_time_partitions`, `inherit_privileges`, `constraint_valid`, `ignore_default_data`, `maintenance_order`) | a follow-up `UPDATE part_config`, emitted only when the intent differs from partman's own defaults |
| (c) | 5 | runtime state (`datetime_string`, `undo_in_progress`, `maintenance_last_run`, `async_partitioning_in_progress`, `sub_partition_set_full`) | never captured |

Every (a) and (b) column is on the hashed payload, so drift in a (b) column is
**visible** (it replaces the intent) rather than silently dropped. A unit test
asserts `payloadAttrs` covers every captured key, so a column added by a future
partman cannot slip through unnoticed.

Deviations from the sketch, each deliberate:

- **No `parent_sub` intent kind.** A sub-partitioned set is **scoped out** with
  an `INTENT_UNSUPPORTED` warning (mirroring pgmq's partitioned queues):
  `create_sub_parent` writes a `part_config_sub` row on the top parent *and* a
  `part_config` row per partman-created sub-parent, so neither row is a faithful
  `create_parent` replay. Their partitions stay `managedBy`-tagged at every
  level, so nothing plans a `DROP TABLE`.
- **Drop is `DELETE FROM part_config`, not `undo_partition`.**
  `undo_partition()` requires a separate `p_target_table` to move rows into and
  is batched by `p_loop_count` (verified on 5.3.1), so it cannot be a replay at
  all. Deregistering is the minimal honest inverse and destroys nothing
  (`dataLoss: "none"`); the now-unmanaged partitions surface as ordinary user
  tables that a second sync round removes under the normal data-loss gate. See
  the CLI-2044 triage in `docs/roadmap/pg-delta-next-follow-ups.md`.
- **`partition_type` is `range`/`list` only** (5.3.1's own
  `check_partition_type`), and `p_type` **does** exist in 5.3.x — it was removed
  in 5.0 and later reintroduced.
- **`p_default_table` has no `part_config` column** but is real intent, so it is
  recovered structurally from `pg_partitioned_table.partdefid <> 0`.
  `p_start_partition` / `p_offset_id` are one-shot boundaries for the first
  premade set and are NOT captured; `p_control_not_null` is a pure guard
  (partman raises on a nullable control column, never mutates) and is always
  passed as `false`.
- **`partmanSchema` rides on the payload.** pg_partman is relocatable and an
  `IntentKindRule` sees only the fact (there is no view on `drop`), so the
  install schema must be on the payload for the replay to be renderable.
- **The auto-created template table is `managedBy`.** `create_parent` creates
  `<partman_schema>.template_<parent_schema>_<parent_name>`, which carries no
  `pg_depend deptype='e'` and would otherwise export as a user table — an
  ordering hazard the by-object loader cannot resolve, since `create_parent`
  creates it `IF NOT EXISTS` and the later `CREATE TABLE` would then fail
  permanently. A user-supplied template table stays a normal fact and is
  `consumes`d by the replay (partman errors on a missing one, so the loader's
  retry rounds converge).

### 3.4 supabase_vault / pg_net (boundary cases)

- **vault**: **presence-only** handler. Captures "enabled"; never reads
  `vault.secrets`. If the source has vault-encrypted columns but the target
  lacks the extension, the plan emits a **clear blocking error** (CLI-1434).
- **pg_net**: environment-specific URLs/secrets in function bodies are a
  **rewrite/templating** concern (CLI-1433), distinct from intent capture. Out of
  scope here; the handler interface (§4.1) reserves an optional `rewrite` hook.

---

## 4. Architecture

```text
 live DB ──────────────┐   core extract:    pg_catalog        → schema facts
 SQL files ─ shadow ───┤   handler capture:  ext catalogs      → intent facts + managedBy edges
 snapshot ─────────────┘   (one exported snapshot; integration-aware extract)
                │
                ▼
        ONE FACT BASE   schema facts + intent facts + edges
                │        ( managedBy edges mark operationally-created objects )
                │  resolveView:  managedBy provenance → project out   (Deliverable A)
                ▼
        generic hash diff  → deltas  (schema + intent, one Delta type, O(changed))
                ▼
        ONE rule table  (schema rules + registered handler intent rules) → actions
                ▼
        ONE graph → one deterministic sort
        (replay actions are ordinary nodes, wired by consumes / produces)
                ▼
        PROOF: apply to clone → re-extract (core + handlers) → hash-compare both;
        data-preservation seeds messages / partition rows
                ▼
        apply (segmented, transactionality-aware)
```

### 4.1 The handler — a generic engine extension point

The handler mechanism (interface, capture-into-the-fact-base, intent-rule
registration) is a **generic capability of `pg-delta`**, *not*
Supabase-specific: pgmq/cron/partman are general extensions, usable outside
Supabase. Handlers register into the engine like rules; the Supabase integration
**composes** a chosen set of handlers with its managed-schema/role policy and
baseline (§3.9). A non-Supabase consumer can register the pgmq handler alone.

A handler is data with functions in narrow slots only (rule-table discipline,
guardrail 3). It needs to read non-`pg_catalog` tables, so it lives **above
core** (`src/policy/extensions/<ext>.ts` for the bundled Supabase set; the
interface itself is engine-level).

```ts
interface ExtensionHandler {
  extension: string;                       // "pgmq" | "pg_cron" | "pg_partman"
  versions?: string;                       // semver range supported

  /** resolve install + schema dynamically; null ⇒ not installed */
  detect(ctx: CaptureCtx): { schema: string } | null;

  /** P1 — read the extension's OWN catalogs and EMIT into the shared fact base:
   *  intent facts (extensionIntent:…) AND `managedBy` edges on the operational
   *  objects the extension created. The single intent reader for all frontends. */
  capture(ctx: CaptureCtx): { facts: Fact[]; edges: DependencyEdge[] };

  /** P2 — register rules for this handler's intent kinds into the one rule
   *  table; the generic planner dispatches by kind exactly as for schema. */
  intentKinds: Record<string, IntentKindRule>;

  /** OPTIONAL authoring sugar (deferred — §8); reduces to capture (§4.3). */
  declarativeSchema?: ZodSchema;
  materialize?(block: unknown, shadow: Conn): Promise<void>;

  /** reserved for pg_net-class templating (out of v1 scope) */
  rewrite?(fact: Fact, env: Env): Fact;
}

interface IntentKindRule {
  create(f: Fact, view: FactView): ReplayAction;
  drop(f: Fact, view: FactView): ReplayAction;
  alter?: Record<string, AttributeRule>;       // changed attr → in-place replay
  consumes(f: Fact, view: FactView): StableId[];// schema facts the replay references
  produces(f: Fact): StableId[];                // intent id + owned operational ids
  dataLoss(a: ReplayAction): "none" | "destructive";
  transactionality(a: ReplayAction): "transactional" | "non" | "either";
}
```

`ReplayAction` is an ordinary `Action` (`target-architecture.md` §3.5) whose SQL
is a `select <ext>.<fn>(...)` call. It carries the same metadata as any action,
so planner, sort, safety report, and executor treat it uniformly. There is **no
`captureIntent → IntentFact[]`** and **no `ownedObjects → StableId[]`** — both
collapse into `capture` emitting facts + edges, because *provenance is data*
(§3.1): the `managedBy` edge is the filter signal (§4.3), the intent rule's
`produces`, and the data-preservation seed target — one concept, three readers.

> **Implementation note (pg_cron slice, shipped).** The concrete `IntentKindRule`
> in `src/plan/rules.ts` collapses the sketch's separate `consumes` / `produces` /
> `dataLoss` / `transactionality` slots into the SAME `ActionSpec` the schema
> rules already return (a `create`/`drop` returning `ActionSpec[]` carries those
> as per-spec fields) — one action-metadata grammar, not two. `alter?` is kept,
> but a rule instead declares `payloadAttrs: string[]`; every listed attribute is
> treated as `"replace"` (extension intent has no in-place ALTER), and a *changed*
> attribute NOT listed trips the "extend the rule vocabulary" guard, so payload
> evolution fails loudly. And "register … into the one rule table" is realized as
> a per-plan **resolver** (`buildRuleResolver(intentRules)`), NOT a mutation of the
> global `RULES`: the resolved profile supplies its handlers' `intentKinds` as
> `PlanOptions.intentRules`, and `rules.ts` stays the single lookup seam — this
> keeps `plan()` pure (no global state) across the corpus's many plans per process.

### 4.2 Diff, rule table, graph, proof — all unchanged

Because intent facts are facts, the generic differ already emits intent deltas
(`add queue`, `set partman.parent.retention`, `remove job`) alongside schema
deltas, as one `Delta` stream. The rule table dispatches by `kind`; handler
intent kinds are simply more registered kinds. The one-graph sort orders replay
actions among schema actions by their `consumes`/`produces`. The proof loop
re-extracts (core + handlers) and hash-compares. Rename, drift, snapshot
round-trip, and the safety report all extend to intent **for free** — the payoff
of one fact base over a parallel relation.

### 4.3 Provenance filtering (Deliverable A — closes CLI-1555, the no-data-loss half)

`capture` attaches a `managedBy(<ext>)` edge to every operationally-created
object (partman children, pgmq `q_*`/`a_*` tables) — provenance as data (§3.1).
`resolveView` (`src/policy/policy.ts`) then projects out every `managedBy`-tagged
fact **and its descendant subtree** (the child table's columns/constraints),
pruning edges with a removed endpoint — exactly as it already does for
`memberOfExtension`. It is the **single projection point**: `managedBy` and
`memberOfExtension` are two provenance cases of the one `excludeByProvenance`
primitive (`src/policy/view.ts`; `excludeManaged` is the thin named wrapper). The
projection mirrors `subtractBaseline`.

**Exclusion is at the FACT level, not the delta level — and this matters for
the proof.** A tempting alternative is a policy *filter rule* over deltas
(`{ edgeTo: { edgeKind: "managedBy" } } → exclude`). It is wrong here: a
delta-only filter would make the proof **drift** — the clone keeps the children,
`desired` lacks them — so the invariant "the plan you prove == the plan you run
== the data-preserving plan" (§6) only holds when the facts are removed on **both
sides + the proof re-extract**. That is why managedBy exclusion is a built-in
provenance projection in `resolveView` (universal, not Supabase-specific), not a
policy rule. (The DSL *does* now support edge-kind predicates — `edgeTo: {
edgeKind }` matches the edge's `EdgeKind`, used by policy scope rules — but the
data-loss-class managed exclusion must apply to everyone, so it lives in the
view projection, not behind a policy.)

A **user-declared** `PARTITION OF` carries no `managedBy` edge, so its intended
drop still fires — the #5491 false-suppression regression cannot recur by
construction (regression-tested in `src/policy/managed.test.ts`). The signal is
sourced exactly where CLI-1591 requires it — the extension's own catalog, in
the integration layer, never `src/core`.

> **Implemented (Phase A — wired into the default path).**
> `EdgeKind += "managedBy"` (`src/core/fact.ts`); the `ExtensionHandler` contract
> (`src/extract/handler.ts`) whose `capture(ctx, current)` runs on the SAME
> snapshot-bound transaction as core extraction — `extract(pool, { handlers })`
> (`src/extract/extract.ts`) runs them before COMMIT, so handler `managedBy` edges
> describe the same moment in DB time as the core facts. The **pg_partman**
> handler reads `part_config` + a recursive `pg_inherits` walk
> (`src/policy/extensions/pg-partman.ts`). `resolveView` projects out `managedBy`
> (`src/policy/policy.ts`) so the managed view is correct at every entry point.
> The **integration profile** (`src/integrations/`; `supabaseProfile`) composes
> handlers + policy + baseline + capability and is wired into `plan`, `prove`,
> `apply`, and the CLI (`--profile supabase`); `apply`'s fingerprint gate and
> `provePlan`'s re-extract both re-extract handler-aware via the profile, so the
> live proof loop stays consistent. Proven end-to-end against a real pg_partman
> DB on the Supabase image (`tests/extension-intent-partman.test.ts`): the raw
> diff drops the children; the profile path stops it and preserves the parent.
> **Remaining for production:** Phase B (intent replay — `create_parent` etc.).

### 4.4 One intent reader, three doors (the hybrid sourcing, made uniform)

There is exactly **one** intent reader — `capture` — mirroring P1's "one
elaborator":

- **Live DB**: `capture` reads the source's extension catalogs directly, under
  the same exported snapshot as schema extraction (consistency — §3.2).
- **SQL files (shadow)**: the files contain the replay calls (`select
  pgmq.create('jobs');` …). The shadow loader runs them; `pgmq.create` has DDL
  side-effects but writes **no user-table rows**, so it passes the loader's
  parser-free DML rejection. After loading, `capture` reads the **shadow's**
  extension catalogs. Same reader.
- **Declarative block (deferred sugar)**: a typed `[extensions.*]` block that
  `handler.materialize` would expand into the same replay calls against the
  shadow before capture. **Deferred to B+** (§8): it is a *second representation*
  of intent and the files path already works without it.

Net: intent enters the system exactly one way — by being read from a Postgres
that actually holds it (live source, or a shadow built from the replay calls).
This is the same move P1 makes for schema, and it answers RFC open question #2
(CLI-1431): the declarative source "format" is *the replay calls themselves*,
read back by capture — not a parallel semantics engine.

### 4.5 The opaque-command strategy (the P1 honest cost, reused)

`cron.command` and partman maintenance calls are opaque strings we refuse to
parse — the same blind spot `pg_depend` has for PL/pgSQL bodies
(`target-architecture.md` §7). Same layered defense: (1) order intent replay
conservatively late (a late tie-break weight in the one sort); (2) rely on
run-time late binding (a cron command resolves when it fires, not at apply);
(3) the **proof loop catches a genuine ordering gap before production** — a
replay call that fails against the clone fails the gate. No body parsing in the
trusted path.

---

## 5. Phasing

Deliverable A and B are sequential (B needs A's detection), and A ships alone
with immediate value (stops data loss).

| Phase | Content | Closes | Gate |
|---|---|---|---|
| **A — Filter** | handler `detect` + `capture` emitting `managedBy` edges; Supabase policy exclude rule (capture read-only/diagnostic at this stage) | CLI-1555, the no-data-loss half of CLI-1591 | Corpus: managed objects produce **no** schema delta; a native `PARTITION OF` drop **still** fires; data-preservation proof on seeded partition rows |
| **B — Replay** | `intentKinds` rules; intent deltas flow through the one diff/graph/proof; replay wired by `consumes`/`produces` | CLI-1591 rebuild fidelity, CLI-341 (cron), schema-side of CLI-1385 | Corpus: from-empty rebuild recreates queues/jobs/parents; intent round-trips both directions; data-preservation across the rebuild |
| **B+ — Authoring sugar** | `declarativeSchema` + `materialize`; the typed block | CLI-1431 (only if raw replay calls prove error-prone) | Block → shadow → capture ≡ live capture |

Per-extension rollout within B follows CLI-1430: pgmq (no `consumes`, simplest) →
pg_cron (opaque command, late-order) → pg_partman (consumes parent, richest
config).

---

## 6. Proof (intent is proven, not just reported)

The proof loop is the arbiter (guardrail 9), extended to intent because intent
is just facts:

1. **State proof (schema)** — unchanged: apply, re-extract, hash-compare.
   Operational objects are excluded on both sides (provenance), so they never
   cause a false diff.
2. **Intent proof** — re-capture intent via the handlers and hash-compare against
   desired. Zero intent diff = the replay reproduced the declared
   queues/jobs/parents (and implicitly, their operational objects exist).
3. **Data-preservation proof** — the keystone. Distinguish two cases, because
   they preserve data differently and the proof must check the right one:
   - **Incremental apply** (target already has the managed objects): the filter
     keeps them untouched, so seeded **queue messages** and **partition rows**
     survive. Asserted directly.
   - **Rebuild from empty** (branch creation): replay premakes *empty* children /
     queues — correct under the schema-only contract (rows are seeded
     separately, never moved by us). The proof asserts the *structure* is
     reproduced, not that rows appear.

The generative engine extends naturally: generate queues/jobs/parents, mutate
intent, roundtrip through the proof loop including data preservation.

---

## 7. Plan artifact & safety surface

Replay actions appear in the plan artifact like any action, carrying
`dataLoss`/`lockClass`/`transactionality`. So **Risk 2.0** (CLI-1459) covers
them for free: `pgmq.drop_queue` and a destructive `undo_partition` surface as
hazards in the same proof-verified safety report. No separate risk path.

---

## 8. Honest costs & open questions

- **Capture reads non-`pg_catalog` tables.** Strictly an integration-layer
  capability (core forbids it). Intended — intent is vendor knowledge.
- **Shadow/clone must carry the extension binaries.** capture-from-shadow and
  proof both require the extension installed in the ephemeral Postgres. Supabase
  images carry them; a generic shadow without the extension **degrades to
  filter-only (Phase A) with a clear notice**, never to a wrong replay. Same
  class as the §7 extension-parity cost.
- **The declarative block is deferred (not cut).** Because the files path
  reduces to capture-after-running-the-replay-calls, a typed `[extensions.*]`
  block is a *second representation* of the same intent — a divergence surface
  (P2's warning). v1 ships one representation (replay calls in the schema files);
  the block lands in B+ only if field evidence shows the raw calls are too
  error-prone.
- **Extension-version skew.** Intent shape can change across versions (pgmq
  `meta`, partman `part_config`). Handlers are version-keyed; unsupported
  versions degrade to filter-only with a notice, never a wrong replay.
- **Opaque commands** (cron, maintenance) are ordered conservatively and trusted
  to late-bind; a real gap surfaces in proof, not production (§4.5).
- **Idempotency / plan-to-target.** Replay is diff-driven (emit `create` only
  when the intent is absent on the target — both sides are captured), so we never
  blind-run `pgmq.create` against an existing queue; where a create fn isn't
  idempotent, the rule guards on existence.
- **partman maintenance scheduling** (pg_partman_bgw / pg_cron `run_maintenance`)
  — intent or operational? v1: out of intent scope; revisit per CLI-1430.
- **Cross-extension edges.** partman uses pg_cron for maintenance; the one-graph
  model supports cross-handler `consumes`/`produces` edges, but the matrix
  (CLI-1430) must enumerate them.

---

## 9. Issue mapping

| Issue | This design |
|---|---|
| CLI-1385 (parent) | Schema/intent half designed here; pure data-diffing (messages, run history, rows) stays **out of scope** (§1). |
| CLI-1555 (partman drops) | Phase A: `capture` `managedBy` edges + policy filter. |
| CLI-1591 (partman intent) | Phase A (drops) + Phase B (`create_parent` replay via intent rules). |
| CLI-341 (cron not listed) | Phase B: pg_cron handler captures + replays jobs. |
| CLI-1430 (intent matrix) | Authoritative column→intent spec the handlers consume; §3 is the v1 cut. |
| CLI-1431 (declarative source format) | §4.4: the replay calls *are* the format, read by capture; typed block deferred to B+. |
| CLI-1434 (vault) | §3.4: presence-only + blocking error. |
| CLI-1435 (cron ownership) | §3.2: `username` normalization on capture (profile-supplied `jobOwnerAliases`) + `defaultJobOwner` elision on replay. |
| CLI-1433 (pg_net templating) | Reserved `rewrite` hook (§4.1); full design deferred. |
| CLI-1432 (cross-schema triggers) | Orthogonal — already handled by the Supabase policy (assessment §3). |

---

## 10. Decision log

- **2026-06-13 (a)** — Feature scoped: **filter + intent replay**, phased
  (A→B→B+); **hybrid sourcing**; **sidecar by contract**. DML stays out of scope
  (§1); P1 (Postgres/the extension is the only elaborator) preserved.
- **2026-06-13 (b)** — Boundary fixed: capture **intent**, never payload data.
  Messages, run history, partition rows, vault secrets are never read; rows and
  messages are *preserved* (data-preservation proof), never moved. Operational
  objects are filtered via `managedBy` provenance edges sourced from the
  extension's own catalog in the integration layer.
- **2026-06-13 (c)** — **Optimization pass** (maintainer: "seek the technical
  optimum"). The rev-a draft modeled intent as a **separate fact relation with
  its own diff/proof** — duplicated machinery and a second granularity (§8.7,
  guardrail 8). Corrected to a **single fact base**: intent facts are
  integration-produced, provenance-tagged facts flowing through the **identical**
  generic diff / graph / proof / rename / safety machinery. "Sidecar" is
  redefined as a *production-and-contract* boundary, not a separate structure —
  the earlier sidecar-vs-first-class framing was a false dichotomy; the optimum
  yields the boundary **and** machinery unification, snapshot/drift/rename
  coverage for free. Follow-on corrections: the handler mechanism is a **generic
  engine registry** (not Supabase-coupled), Supabase merely composes handlers;
  operational filtering is a **`managedBy` edge** emitted by `capture` (not an
  `ownedObjects` list); cron schedule/command changes use **unschedule +
  reschedule by name** (static) over `alter_job` (runtime id); core gains **one
  generic `extensionIntent` StableId kind** (not one per extension); the typed
  declarative block is **deferred** to B+ (one representation in v1).
- **Open** (to CLI-1430): exact `part_config` intent-column subset; whether
  partman maintenance scheduling is intent; cross-extension ordering edges.
```
