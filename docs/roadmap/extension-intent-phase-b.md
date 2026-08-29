# Extension intent — Phase B implementation plan (intent replay)

- **Status**: Ready to execute. Phase A (filter / no-data-loss) is shipped and
  proven; this plan covers Phase B (capture + replay intent for rebuild
  fidelity). Parks the work so it can be resumed cold.
- **Date**: 2026-06-13
- **Design**: `docs/architecture/extension-intent.md` (the *what* and *why*). This doc is the
  *how* — concrete files, contracts, sequencing, and gotchas mapped against the
  real code.
- **Branch / baseline**: `feat/pg-delta-next` @ `06782d8`.
- **Closes (on completion)**: CLI-1591 Deliverable B (partman `create_parent`),
  CLI-341 (pg_cron jobs), the schema-side of CLI-1385; sets up CLI-1430/1431.

> **One sentence.** Phase B makes a from-scratch rebuild recreate the queues /
> schedules / partman parents a project declared, by capturing them as
> `extensionIntent` facts and replaying them through the extension's own API
> (`pgmq.create`, `cron.schedule`, `partman.create_parent`), ordered and proven
> by the same one-graph sort + proof loop as schema — no second pipeline.

---

## 0. What Phase A already built (the substrate B extends)

> The substrate is now the **integration profile** (the post-handoff-review
> refactor). The old `excludeManaged` / `extractWithHandlers` / `extractManaged`
> recipe was removed — handlers run inside `extract`, `resolveView` projects
> `managedBy`, and `resolveProfile` composes the option bundles. Build Phase B on
> the profile, not the removed helpers.

- `EdgeKind` includes `"managedBy"` (`src/core/fact.ts`).
- The `ExtensionHandler` contract lives in `src/extract/handler.ts`; its
  `capture(ctx, current)` receives a **snapshot-bound** `HandlerContext`.
  `extract(pool, { handlers })` (`src/extract/extract.ts`) runs handlers inside
  the same repeatable-read transaction as core extraction. The **pg_partman**
  handler emits `managedBy` edges from `part_config` + a recursive `pg_inherits`
  walk (`src/policy/extensions/pg-partman.ts`).
- `resolveView(...)` (`src/policy/policy.ts`) is the **single projection point**:
  it projects out `managedBy` (and `memberOfExtension`) facts + descendants, on
  both sides and the proof re-extract. (`excludeByProvenance` in
  `src/policy/view.ts` is the underlying primitive; there is no caller-side
  `excludeManaged` step anymore.)
- `resolveProfile(pool, profile, …)` (`src/integrations/`) is the public
  composition module. It returns a handler-aware `extract` plus `planOptions` /
  `proveOptions` / `applyOptions` whose `reextract` re-extracts handler-aware, so
  the proof re-extract and the apply fingerprint gate reconstruct the same
  managed view. `provePlan` / `apply` accept that `reextract` option directly.

Phase B adds the **intent** half: handlers also emit `extensionIntent` facts,
and the planner renders them as replay actions.

---

## 1. The contracts B builds against (verified at `06782d8`)

### StableId codec (`src/core/stable-id.ts`)
- Kind sets: `SIMPLE_KINDS`, `QUALIFIED_KINDS`, `SUBENTITY_KINDS`,
  `ROUTINE_KINDS`, plus bespoke kinds (membership, userMapping, typeAttribute,
  publicationRel, publicationSchema, comment, acl, securityLabel,
  defaultPrivilege).
- `StableId` union (lines ~52–76); `FactKind = StableId["kind"]`.
- `encodeId(id)` switch (~97–131) and `parseAt(c)` switch (~241–313) — both must
  gain a branch for any new kind. The bespoke `publicationRel` (a kind + 3
  string discriminators) is the closest existing template.

### Rule table (`src/plan/rules.ts`)
- `ActionSpec` (lines ~23–55), full field set:
  `sql; consumes?; alsoProduces?; alsoDestroys?; releases?; dataLoss?;
  rewriteRisk?; lockClass?; transactionality?; compaction?; acceptsColumnFolds?`.
- `KindRules` (lines ~104–141): `create(fact, view, params?) => ActionSpec[]`,
  **`drop(fact) => ActionSpec`** (no params today), optional `rename`,
  `attributes`, `weight`, and graph flags (`metadata`, `cascadesToChildren`,
  `rebuildable`, `suppressible`, `dropRootRedirect`, `defaclObjtype`).
- `PlanParams = Record<string, unknown>` (line ~69); **`KNOWN_PARAMS`** is the
  allow-list — `plan()` throws on any param name not in it.
- `RULES: Record<string, KindRules>` (line ~522); `rulesFor(kind)` (lines
  ~2261–2269) throws on unknown kind.
- Simple template to copy: the `extension` / `schema` rule entries (both read
  `params` in `create`).

### Planner (`src/plan/plan.ts`)
- `PlanOptions` (~90–108): `params?, policy?, renames?, acceptRenames?, compact?`.
- `params` validated against `KNOWN_PARAMS` (~134–146).
- `paramsFor(fact)` (~372–387) merges policy serialize-rule params + global
  `options.params` per fact (global params reach every fact).
- `emitCreate` (~389–400) calls `rulesFor(kind).create(fact, base, paramsFor(fact))`.
- **Drop call sites that need the params thread (2):** the drop loop (~490) and
  the replace path (~514) call `rulesFor(kind).drop(fact)`.

### Proof (`src/proof/prove.ts`)
- `provePlan(plan, clonePool, desired, { reextract })`; default reextract is
  core `extract`. The profile supplies a handler-aware `reextract`
  (`ctx.proveOptions.reextract`, i.e. `extract(pool, { handlers })`), so the
  proof re-extract emits the same `managedBy` edges and `resolveView` projects
  the same managed view.

---

## 2. The one real design decision (settled)

**Intent rules reach the rule table via `PlanParams`, not a global registry or a
core→handler import.** Core (`rules.ts`) must not import the pgmq/cron/partman
handlers (layering). So the integration injects its intent rules as a plan
param:

```ts
// PlanParams carries (cast at the rule):
//   intentRules: Map<`${ext}/${intentKind}`, IntentKindRule>
```

The `extensionIntent` rule in `rules.ts` is generic: it looks up
`params.intentRules.get(`${id.ext}/${id.intentKind}`)` and delegates
`create`/`drop`/attribute rendering. Consequence: **`KindRules.drop` must gain
an optional `params?: PlanParams`** (only `create` has it today), and the 2
`plan.ts` drop call sites pass `paramsFor(fact)`. Existing `drop: (fact) => …`
impls are assignable unchanged (fewer params is fine) — so this is a 2-call-site
change, not a 30-rule change. Add `"intentRules"` to `KNOWN_PARAMS`.

Rejected alternatives: a module-level mutable registry (global state, test
isolation hazard) and importing handlers into core (layering violation).

---

## 3. Sequencing (each step its own RED→GREEN; commit at green)

### Step 1 — `extensionIntent` codec (isolated, zero planner risk)
- Add `{ kind: "extensionIntent"; ext: string; intentKind: string; key: string }`
  to the `StableId` union.
- Add the `encodeId` branch: `extensionIntent:${seg(ext)}.${seg(intentKind)}.${seg(key)}`.
- Add the `parseAt` branch (mirror `publicationRel`).
- **RED→GREEN**: a round-trip property test in `stable-id.test.ts`
  (`parseId(encodeId(x)) === x`) for the new kind, incl. names needing quoting.
- Gate: `bun test src/core/stable-id.test.ts`; check-types.
- **Commit** (`feat(pg-delta): extensionIntent stable-id kind`).

### Step 2 — intent rules in the rule table + planner thread
- Define `IntentKindRule` and `IntentRegistry` (a `Map`) — put them where the
  rule table can import the *types* without importing handlers
  (e.g. `src/plan/intent.ts`, types only):
  ```ts
  interface IntentKindRule {
    create(fact: Fact, view: FactView): ActionSpec;
    drop(fact: Fact): ActionSpec;
    attributes?: Record<string, AttributeRule>;
  }
  type IntentRegistry = Map<string, IntentKindRule>; // key: `${ext}/${intentKind}`
  ```
- `rules.ts`: add `"intentRules"` to `KNOWN_PARAMS`; add the `extensionIntent`
  RULES entry whose `create(fact, view, params)` and `drop(fact, params)`
  resolve `params.intentRules` and delegate (throw a clear error if a fact's
  `ext/intentKind` has no registered rule — guardrail 3: extend the vocabulary,
  don't hack the planner). Pick a `weight` (intent replays late — high weight).
- `rules.ts`: widen `KindRules.drop` to `drop(fact: Fact, params?: PlanParams)`.
- `plan.ts`: pass `paramsFor(fact)` at the 2 drop call sites.
- **RED→GREEN (unit, Docker-free)**: build a synthetic fact base with one
  `extensionIntent` fact + a stub `intentRules` map; `plan(empty, desired,
  { params: { intentRules } })` and assert the replay action's SQL +
  `consumes`/`produces` land in the plan; an `add`→`remove` flip yields the drop
  replay. Assert `rulesFor("extensionIntent").drop` with no registry throws.
- Gate: `bun test src/` (all 194+ still green — proves the `drop` signature
  change + new kind didn't regress the planner).
- **Commit** (`feat(pg-delta): extensionIntent rule + intent-rule registry via PlanParams`).

### Step 3 — capture + replay per extension (one handler per commit)
Order by complexity (validate the mechanism on the simplest first):

1. **pgmq** (no `consumes` — self-contained):
   - capture: read pgmq's queue registry (`<schema>.meta` / `pgmq.list_queues()`)
     → `extensionIntent{ext:"pgmq",intentKind:"queue",key:<name>}` facts (payload:
     type, partition/retention). Still emit the existing `managedBy` edges on
     `q_*`/`a_*` (Phase A).
   - intentKind rule: `create` → `select `pgmq.create` (or `_unlogged` / `_partitioned` variants)`,
     `drop` → `select pgmq.drop_queue(…)` (`dataLoss:"destructive"`), `produces`
     the queue + (via managedBy) its operational tables.
   - integration test: from-empty rebuild recreates the queue; drop removes it.

2. **pg_cron** (opaque command — order late):
   - capture: read `cron.job` → `extensionIntent{ext:"pg_cron",intentKind:"job",…}`;
     normalize `username` (CLI-1435).
   - intentKind rule: `create` → `cron.schedule(…)`; a schedule/command/active
     change → **`unschedule` + re-`schedule` by name** (static; avoid
     `alter_job`'s runtime id); `drop` → `cron.unschedule(…)`.
   - integration test: rebuild recreates the job; change re-schedules it.

3. **pg_partman** Deliverable B (`consumes` the parent):
   - capture: read `part_config` (+ `part_config_sub`) → intent facts (the
     intent-column subset — CLI-1430). Keep Phase A's child `managedBy` edges.
   - intentKind rule: `create` → `partman.create_parent(…)` + a
     `set_part_config`-style follow-up; `consumes` the parent table fact so it
     orders after `CREATE TABLE`.
   - integration test: rebuild from a bare parent recreates partman config +
     premade children.
- **Commit per handler** (`feat(pg-delta): pgmq intent replay`, …).

### Step 4 — intent proof + full regression
- Extend the proof: after apply, the handler-aware re-extract
  (`ctx.proveOptions.reextract`) must converge on intent too (it already does —
  intent facts flow through the same diff). Add a
  replay-roundtrip integration test per extension asserting `verdict.ok` and
  intent re-capture equality, plus data-preservation (seeded queue messages /
  partition rows survive where the plan claims `dataLoss:"none"`).
- **Full corpus regression** before the final push:
  `PGDELTA_TEST_POSTGRES_VERSIONS=17 bun run test tests/` (and the sharded/15
  pass if iterating) — the Step 2 planner-core change (new kind + `drop`
  signature) must not regress any existing scenario.
- Gate: corpus green both PG versions; differential clean; lint/types/knip.

---

## 4. Gotchas captured from Phase A

- **Proof consistency is fact-level.** Intent + managed exclusion must be
  applied symmetrically to source, desired, AND the proof `reextract` (the
  profile's handler-aware re-extractor, projected through `resolveView`). A
  delta-only filter drifts the proof. (Already learned;
  applies to intent facts too — but intent facts are *kept*, only operational
  objects are excluded.)
- **Desired must keep the extension installed.** A declarative desired that
  drops `pg_partman` un-manages the children (the proof then can't exclude them).
  Real declarative sources declare the extension; tests must install it on the
  desired side too. (This bit the Phase A roundtrip test.)
- **`WITH RECURSIVE`** for the `pg_inherits` descendant walk (not bare `WITH`).
- **partman v5 signature**: `create_parent(p_parent_table, p_control, p_interval)`
  named params; the parent must already be `PARTITION BY RANGE`. v5 is always
  native (no `p_type`).
- **Opaque commands** (cron): never parse; order replay late (high `weight`);
  rely on run-time late binding; the proof catches a real ordering gap.
- **Test image**: `supabase/postgres:17.6.1.167` (ships pg_partman/pgmq/pg_cron);
  `supabaseCluster()` in `tests/containers.ts`. Heavy — keep extension-intent
  integration tests in their own files reusing the lazy singleton.
- **Deferred (B+)**: the typed `[extensions.*]` declarative block — the files
  path already reduces to capture-after-running-the-replay-calls, so the block
  is a second representation (P2 divergence risk). Add only if raw calls prove
  error-prone (CLI-1431).

---

## 5. Done-when

- A from-empty rebuild against a project using pgmq / pg_cron / pg_partman
  recreates the declared queues / jobs / partman parents (intent replay), with
  no drop of managed objects and no row loss, **proven** by the proof loop
  (state + intent convergence + data-preservation) on the Supabase image.
- Full corpus green on PG 15 + 17; the planner-core change (new kind, `drop`
  signature) regresses nothing.
- `docs/architecture/extension-intent.md` §5 phase table updated (B → done); per-extension
  intent-column specifics reconciled with CLI-1430.
