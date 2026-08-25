# North Star Architecture: pg-delta & pg-topo

- **Status**: North star — the project's target design, judged on technical
  merit alone, deliberately ignoring migration cost and past choices.
  **The rebuild and the cutover it describes have shipped**: the clean-room
  engine is `@supabase/pg-delta`. This document remains the authoritative
  statement of *why* the design is what it is; for what the code does today,
  read the code and [README.md](README.md).
- **Date**: 2026-06-12
- **Baseline for all code citations**: commit `115dde8`
  (`pg-delta@1.0.0-alpha.28`, `pg-topo@1.0.0-alpha.1`)

> **Code citations below refer to the LEGACY engine** at `115dde8`, which this
> document was written against and which the rewrite replaced. They are
> rendered as plain filenames rather than links on purpose: those paths no
> longer exist under `packages/pg-delta/`, and the structures they name
> (`sort/cycle-breakers.ts`, `objects/*/*.diff.ts`, `catalog.model.ts`, …) are
> exactly the ones the new engine does *not* have. Read them as evidence for
> the argument, not as a map of the current tree; the legacy source is in git
> history.

This document defines where the project is going. It is not a critique of how
it got here: the current design is the strongest in its class (it is the only
tool in the migra/pg-schema-diff family that treats `pg_depend` as the source
of ordering truth), and its accumulated PostgreSQL knowledge is the asset the
north star is built from. But the north star is derived from the problem, not
from the codebase — and it is a **clean-room library**: the old engine
donates assets (§5) and serves as a differential oracle (§9), and nothing
else. No format, API, or mechanism carries over for compatibility's sake.
§9 defines the build-and-cutover plan. When a local decision conflicts with
this document, this document wins or this document gets amended.

---

## 1. The problem, stated purely

Given two PostgreSQL schema states — each obtainable from a live database,
from SQL files, or from a serialized snapshot — produce a **minimal,
correctly ordered, reviewable, safety-classified** DDL script that transforms
one state into the other, **deterministically**, and be able to **prove** it
did.

Five sub-problems follow from this statement, and any architecture in this
space must answer all five: state capture, comparison, action synthesis,
ordering, execution. Every serious tool (pg_dump/pg_restore itself, migra,
pg-schema-diff, atlas, skeema) converges on this staged shape; the
architectural freedom — and where this design differs from the current
codebase — is *within* the stages: how state is represented, where semantic
knowledge lives, who is trusted to elaborate PostgreSQL semantics, how cycles
are handled, and how correctness is established.

Out of scope, permanently: data migrations (DML). The tool's contract is
schema state, not data movement.

---

## 2. The two principles

Everything in this design follows from two principles.

### P1 — Postgres is the only elaborator

The single deepest source of bugs in this tool class is reimplementing
PostgreSQL semantics: name resolution, type elaboration, dependency
inference, default normalization. The current codebase half-commits to this
principle (dependency edges come from `pg_depend`, never from parsing — the
right call) but still runs **three** semantic engines:

1. catalog extraction (exact),
2. pg-topo's libpg-query static analysis (approximate — quoted-identifier
   normalization, signature inference, builtin-type filtering are all
   heuristic recoveries of what Postgres already knows),
3. declarative apply's round-based retry, which is "ask Postgres for
   forgiveness, one error message at a time"
   (`round-apply.ts:252-281`,
   worst-case O(n²) statement executions).

The north star has **one**: every input state is resolved by an actual
Postgres instance. Live databases trivially; SQL files by applying them to an
ephemeral shadow database and extracting the result; the system's own output
by applying it to a scratch clone and re-extracting (§3.7). No static SQL
parser exists anywhere in the trusted path. Static analysis survives only as
a developer-experience layer (§4.4).

### P2 — PostgreSQL knowledge exists in exactly two forms

The per-type knowledge — what is alterable, what forces replacement, what
cascades implicitly, what locks, what rewrites — is the irreducible core of
the problem. Today it is smeared across **eight forms**: extractor SQL, Zod
models, per-type diff functions, 106 change classes, serializers, custom
sort constraints, cycle breakers, and post-diff normalization passes. Every
new PostgreSQL version or object type touches most of them.

The north star has **two**:

1. **Extraction queries** — catalog → normalized facts (§3.1). The existing
   extractor SQL corpus, the most valuable code in the repository, survives
   nearly verbatim as the fact producer.
2. **The rule table** — fact-deltas → actions (§3.4).

Everything between — diffing, ordering, planning, verification — is generic
machinery that never changes when Postgres evolves. Supporting PostgreSQL 19
means updating extraction queries and adding rules. **That is the
scalability that matters most over a decade: scaling with PostgreSQL's
evolution, not only with schema size.**

A corollary that the rest of the design depends on: the two forms can only
stay two if state, diff, dependencies, and actions all share **one
granularity** — the fact. The moment state is stored at a coarser grain than
dependencies point at, hand-written translation code reappears (§8.7 shows
this is exactly what happened). The fact base below is therefore not a
storage detail; it is what makes P2 hold.

---

## 3. The architecture

```mermaid
flowchart TB
    LIVE["live DB<br/><i>(single-snapshot extract)</i>"] --> FB
    FILES["SQL files<br/><i>(shadow-DB elaboration)</i>"] --> FB
    SNAP["snapshot JSON"] --> FB
    FB["<b>FACT BASE</b><br/>normalized fact rows + parent & dependency edges;<br/>content hash per fact, Merkle rollups along parents"]
    FB --> DIFF["<b>generic diff</b>: rollup-guided descent → fact-level <b>DELTAS</b><br/><i>(hash compare — zero per-type code, O(changed))</i>"]
    RULES["<b>RULE TABLE</b><br/>the only per-type logic in the system"] --> ACTIONS
    DIFF --> ACTIONS["<b>ATOMIC ACTIONS</b> <i>(≈ 1:1 with deltas)</i><br/>each declares produces / consumes / destroys, lock class,<br/>rewrite risk, data-loss class, transactionality"]
    ACTIONS --> SORT["<b>ONE dependency graph</b> → one deterministic topological sort<br/><i>(a cycle is a rule bug caught by CI, not a runtime repair job)</i>"]
    SORT --> COMPACT["optional <b>COMPACTION</b>: merge adjacent actions into idiomatic DDL<br/>by joining facts along parent relations, only where no edge<br/>crosses the merge <i>(cosmetics; off for machines)</i>"]
    COMPACT --> PLAN["<b>PLAN</b> = ordered deltas + fingerprints + safety report"]
    PLAN --> PROOF["<b>PROOF</b>: apply to scratch clone,<br/>re-extract, hash-compare"]
    PLAN --> APPLY["<b>apply</b><br/><i>(lock-aware segmented txns)</i>"]
```

### 3.1 The fact base: a normalized, content-addressed relation

**Normalized, not nested.** PostgreSQL's own catalog is relational —
`pg_attribute`, `pg_constraint`, `pg_attrdef` are rows referencing their
parents, not sub-documents of `pg_class`. The optimal state representation
mirrors that shape instead of re-imposing a document hierarchy on it: every
addressable thing — table, column, constraint, default, index, trigger,
policy, ACL entry, comment, security label, role membership, extension
membership — is its **own fact**:

```ts
interface Fact {
  id: StableId;             // typed union: column:, constraint:, default:, acl:, comment: …
  parent?: StableId;        // hierarchy as a relation, not as containment
  payload: NormalizedAttrs; // cooked attributes (names not attnums, canonical pg_get_*def)
  hash: ContentHash;        // content hash of the normalized payload
}

interface FactBase {
  facts: Map<StableId, Fact>;
  edges: Set<DependencyEdge>;   // pg_depend-derived + ACL/membership/ownership, as data
  rollup: Map<StableId, Hash>;  // Merkle: parent hash folds children's hashes
}
```

For the operational invariants behind StableId addressability, PostgreSQL OID
carry, ACL equality, underscore metadata, and current-vs-target rename behavior,
see [identity-and-acl.md](identity-and-acl.md).

Six properties define it:

- **Typed identity, structured end-to-end.** IDs are a discriminated union
  (`{kind: "procedure", schema, name, args}` …) everywhere — including at
  the SQL boundary: extraction queries return identity *parts* (kind,
  schema, name, args, parent) as structured columns and never synthesize
  identity strings, so the encoding exists in exactly **one codec**, on the
  library side. (The current system maintains the format twice — TS helpers
  plus `format()` literals inside the dependency mega-query — a divergence
  risk the structured boundary removes outright.) A canonical string
  encoding — one escaping rule, one version tag — is derived from the
  structure and appears only where persistence demands it: snapshots, plan
  artifacts, fingerprints. In memory, graph keys are interned. Structure is
  accessed by field, never recovered by regex. **No format is frozen**:
  persisted artifacts carry a format version, making compatibility a
  versioning concern instead of a design constraint.
- **One granularity everywhere.** Facts, dependency edges, diff deltas, and
  actions all live at the same grain. A `pg_depend` edge that points at a
  column points at a fact that *exists*; nothing maps between coarse state
  and fine dependencies, because there is no coarse state.
- **Content addressing with Merkle rollups.** Every fact hashes its
  normalized payload; every parent's rollup hash folds its children's
  hashes **and its outgoing edge set**, so edge-only changes (an object
  gaining or losing extension ownership, a shifted dependency) are visible
  to hash comparison, not just payload changes. Two consequences: equality
  at any granularity is one comparison, and diffing is **O(changed)** —
  subtrees whose rollups match are skipped wholesale. Fingerprints, no-op
  detection, drift detection, and caching are the same mechanism. Because
  hash equality is the **sole** equality gate (a deep-compare fallback on
  matches would reinstate the full-compare cost on the unchanged majority),
  the digest must be collision-resistant — ≥128 bits over the canonical
  payload encoding (e.g. BLAKE3 or truncated SHA-256), computed once at
  extraction where it amortizes into I/O wait. **Hashes are computed over
  identity-free payloads**: a fact's own name and its parent's name live in
  its `id`, never in the hashed payload — this is what makes rename
  detection (§4.1) possible.
- **Hierarchy is a view, not the storage.** Renderers and the compactor that
  need "a table with its columns and inlineable constraints" *join* facts
  along the parent relation at render time. The document shape exists where
  documents are useful — output — and nowhere else.
- **Cross-cutting metadata is not special.** A comment is a fact whose
  target is another fact's ID; so is an ACL entry, a security label, a
  membership. There is no "scope" dimension in the system — one global rule
  per metadata kind (§3.4) replaces per-object-type reimplementation.
- **Provenance is data.** "Owned by extension X" is an edge fact, not an
  extraction-time filter. Downstream policy (integrations, vendor filtering)
  decides what to do with provenance instead of extraction deciding what to
  hide.

The payload normalization doctrine carries over from today unchanged
(logical names instead of physical attnums; canonical `pg_get_*def()` output
as the comparison form where Postgres provides it): it answers *what we
know* correctly. The fact model changes *how it is keyed* — which is where
the current design pays (§8.7). One sharpening: **which attributes
participate in equality is itself per-kind knowledge** and lives in the
payload definition, not in diff logic. Example: extension versions drift
legitimately across environments, and today's diff deliberately ignores
them
(`extension.diff.ts:53-62`)
even though `version` sits in the equality fields — under the fact model
that tolerance is declared once, by excluding `version` from the hashed
payload (or marking its attribute rule a no-op), instead of being
re-implemented inside an imperative diff.

### 3.2 Frontends: one elaborator, three doors

- **Live database**: all extraction queries run against one exported
  snapshot (`pg_export_snapshot()` + `SET TRANSACTION SNAPSHOT` on N worker
  connections — the pg_dump-parallel model). Parallel *and* consistent.
  Today's extraction has neither property: ~28 queries race over a 5-connection
  pool with no shared transaction
  (`catalog.model.ts:352-381`,
  `postgres-config.ts:108`),
  so the catalog and its dependency rows can disagree under concurrent DDL —
  masked by the `unknown:` filter in
  `graph-builder.ts:26-33`.
- **SQL files**: applied to an ephemeral shadow database, then extracted.
  The desired state is whatever Postgres actually builds — no fuzzy
  reference matching in the trusted path. This *is* the declarative
  workflow. Four specifics the shadow loader owns:
  - **Ordering is best-effort and fail-safe.** Files may not arrive
    apply-ordered; the loader follows the export manifest's recorded
    `loadOrder` when present (else lexicographic path order on the CLI;
    caller-array order in the library), retries deferred
    statements in bounded rounds *against the shadow*, and on a stuck load
    escalates — reconnect once, then kind-based reordering via the
    dev-layer static analyzer. This does not violate P1: ordering
    assistance can only fail to build the shadow — a visible error before
    anything is extracted — never corrupt the desired state, because
    Postgres remains the elaborator. (The objection to round-retry was as
    a *production apply engine* against live targets; on a throwaway
    shadow it is harmless.) The kind-based escalation is the **statement
    reordering assist** — a degradable layer above the parser-free loader;
    see §4.4.1.
  - **Body validation is restored before extraction.** Loading runs with
    `check_function_bodies = off`; accepting the catalog without
    re-checking would admit a typo'd routine body into the desired state —
    and the proof loop would vacuously agree, since it applies the same
    invalid body. After loading, the loader re-validates routine bodies
    with checks on — the same final pass the current declarative engine
    performs
    (`round-apply.ts:445-448`).
  - **Shared objects need cluster isolation.** Roles and memberships are
    cluster-level: in a same-cluster scratch database, `CREATE ROLE` leaks
    out of the shadow and can collide with existing roles. When declarative
    files manage shared objects, the shadow must be an isolated ephemeral
    cluster (throwaway instance/container); a same-cluster scratch database
    is only safe for database-local schemas, and the loader enforces the
    distinction.
  - **Data statements are detected by effect, parser-free — and, by
    default, warned on rather than rejected.** DML would succeed in the
    shadow and then silently vanish from the schema-only plan. After
    loading, the loader checks for observable data: any managed
    non-extension table with rows, never by parsing SQL. In an
    isolated-cluster shadow (the default there), tables that already held
    rows *before* the load are exempt via `allowPreExistingRows` — a
    name-based exemption; row contents are never compared, so an INSERT
    into an already-populated table stays invisible — and surface silently
    as `LoadResult.preExistingPopulatedTables`. Any other populated table
    appends a `data_statement` warning diagnostic to
    `LoadResult.diagnostics` and the run proceeds with the schema-only
    plan. `strictDataStatements` (CLI: `--strict-data-statements`) restores
    the fatal failure and is recommended for CI.
- **Snapshots**: the serialized fact base round-trips losslessly and is the
  contract for offline diffing, fixtures, and caching. A flat fact relation
  serializes, filters, and streams trivially — properties a nested document
  model resists.

### 3.3 Generic diff: rollup-guided descent to fact-level deltas

Comparison is hash algebra, top-down: compare rollups; where they match,
skip the entire subtree; where they differ, descend and compare fact hashes;
where a fact differs, compare payload attributes. The output is the system's
central data type:

```ts
type Delta =
  | { verb: "add";    fact: Fact }
  | { verb: "remove"; fact: Fact }
  | { verb: "set";    id: StableId; attr: string; from: unknown; to: unknown }
  | { verb: "link";   edge: DependencyEdge }    // edge-only changes are deltas too:
  | { verb: "unlink"; edge: DependencyEdge };   // provenance/ownership shifts (§3.9)
```

**Zero per-type diff code — structurally, not aspirationally.** The differ
never knows what a table is. Because state is normalized at fact grain, the
generic differ already produces "the default of `column:public.users.email`
changed" — there is no nested document for per-type code to re-walk. (In a
document model, "generic diff" can only say *this table changed somehow*,
and a second, hand-written diff engine per type must rediscover what — that
is precisely the 1,034 lines of
`table.diff.ts`
today, see §8.7.)

Deltas — not statements, not class instances — are also what plans persist:
a delta list is diffable, replayable, and storable by construction.

### 3.4 The rule table

The only per-type logic in the system: structured data mapping deltas to
actions.

```ts
// sketch — rules are data with functions in narrow slots only
interface KindRules<P> {
  kind: FactKind;
  identitySql(p: P): string;
  createTemplate(p: P, view: FactView): string;     // bare object only (§3.5)
  attributes: Record<string, AttributeRule<P>>;     // per changed attribute:
  //   { alter: (from, to, view) => string }        //   in-place ALTER
  //   | { replace: true }                          //   forces drop+create
  //   | { replace: (from, to) => boolean }         //   conditional (e.g. column type)
  implicitlyRemoves(p: P, view: FactView): StableId[]; // cascade knowledge
  lockClass(a: Action): LockClass;
  rewriteRisk(a: Action): boolean;
  dataLossClass(a: Action): DataLoss;
}
```

Three structural consequences of operating on fact deltas:

- **Cross-cutting kinds get one rule, globally.** `comment(target) = text`
  is a single rule for the entire system — not 21 per-object-type comment
  implementations. Same for ACL entries, security labels, memberships. The
  rule count tracks PostgreSQL's *concepts*, not the cross product of
  concepts × object types.
- **Rules receive fact views, not documents.** A rule that renders
  `CREATE TABLE` asks the view API for the children it may inline; the
  hierarchy it needs is computed, not stored.
- **Multi-fact semantic atoms are delta-set rules.** `ALTER COLUMN … TYPE`
  touches the column fact, possibly its default fact, and invalidates
  dependent index/view facts. A rule may match a *set* of related deltas and
  emit the composite action with the correct teardown/rebuild edges — the
  declarative form of the knowledge that today lives in the `invalidates`
  side channel and the expand-replace pass.

Hard cases remain *conditional rules with more structure*, never imperative
escape hatches — escape hatches are how today's eight-forms situation
happened. The discipline that keeps rules honest: functions confined to
predicate/template slots, and the proof loop (§3.7) as a lie detector — a
rule that misdeclares cascades or alterability produces a state mismatch in
CI the day it is written.

This replaces, outright: 21 per-type diff functions, 106 change classes, the
five per-`objectType` dispatch switches
(`catalog.diff.ts:47`,
`change-utils.ts:10`,
`fingerprint.ts:88`,
`change.types.ts:65`,
`file-mapper.ts:59`),
and the per-type privilege/comment/security-label wrappers — today 256
files / 31,162 LOC of source in `objects/` alone.

### 3.5 Atomic actions: decomposition mirrors normalization

Actions are ≈1:1 with deltas: bare `CREATE TABLE`; every constraint,
default, FK, index, grant, comment, ownership change as its own action. Each
action declares `produces` / `consumes` / `destroys` (fact IDs) plus the
safety metadata from its rule. **Maximal decomposition in the action space
is the same principle as normalization in the state space — one idea seen
from two sides.** A normalized state diffed at fact grain *naturally* yields
atomic actions; the impedance mismatch of decomposed actions over
document-shaped state cannot arise.

This is also pg_dump's deep trick, adopted wholesale: **pg_dump has no
cycle-breaker module because at this granularity, cycles structurally cannot
form** for entire categories of dependencies (mutual FKs, FK-vs-drop
interleavings). Compound semantics stop being implicit: `DROP TABLE`'s
cascade becomes explicit fact-removals related by edges, ordered by the
graph like everything else.

Failure-mode analysis is the argument for avoidance over repair: with
repair, a new cycle class means a wrong or unsortable plan in production and
a new hand-written breaker (the current registry —
`cycle-breakers.ts`:
`tryBreakFkCycle`, `tryBreakPublicationColumnCycle`,
`tryBreakPublicationFkConstraintDropCycle` — each added after a
field-discovered cycle; the codebase even fights itself, with post-diff
normalization *pruning* constraint drops for compactness that the drop-phase
breaker then *re-injects*). With avoidance, the worst case is a more verbose
script. Verbosity is recoverable; wrongness is not.

### 3.6 One graph, one sort, then cosmetic compaction

A single dependency graph over all atomic actions — drops, creates, alters
together. Edges come from three sources: the old state's edge facts
(teardown ordering: an action destroying X follows everything that consumes
X), the new state's edge facts (build ordering: an action producing Y
precedes everything consuming Y), and identity conflicts (remove of `X`
before add of new `X`). One deterministic Kahn pass (heap-based ready queue,
tie-break by kind weight → canonical identity) replaces a two-phase sort, an
`invalidates` side channel, and a repair loop: an in-place mutation is simply
an action that destroys the old fact and produces the new one, and the mixed
graph orders its dependents' teardown and rebuild around it naturally.

**A cycle is a rule bug.** Cycle detection remains as an assertion with a
high-quality diagnostic, and as a property-test target — never as a runtime
repair subsystem.

**Compaction** is the final, optional stage: merge adjacent actions into
idiomatic compound DDL (constraints inlined into `CREATE TABLE`, column
clauses folded) by joining facts along parent relations, only when no graph
edge crosses the merge boundary. It is a peephole optimization on an
already-correct sorted script — it can produce ugliness, never wrongness. On
by default for humans, off for machines.

### 3.7 Plan and proof

A plan is: ordered deltas (with their rendered actions) + source/target
fingerprints — which are now just fact-base rollup hashes, the same
machinery as equality — + the safety report aggregated from per-action
metadata (locks, rewrites, data loss).

**The proof loop is the architecture's keystone.** Because any state can be
materialized and re-extracted, the planner can certify its own output.
Materialization has two forms: **template-cloning** (a cheap file copy —
right for CI, scratch sources, and quiesced databases) and **re-creation
from the extracted fact base** (render the fact base to DDL and apply it to
an empty scratch). The second form exists because
`CREATE DATABASE … TEMPLATE` requires the template database to have no
other active connections — unavailable against a live production source.
Proof against live targets therefore clones the *model* of the source, not
its files; what that certifies is "the plan correctly transforms the state
as extracted," which is the exact claim the proof makes anyway (extractor
blind spots are a separate risk with a separate defense, §4.3).

The proof has two checks, because schema convergence alone has a blind
spot:

1. **State proof.** Apply the plan to a clone of the source, extract,
   hash-compare against the desired fact base. Zero diff = the plan produces
   the right schema.
2. **Data-preservation proof.** A plan that drop+creates a table instead of
   altering it converges to an *identical schema* — and destroys every row.
   State proof cannot see this. So the clone is seeded with rows before
   applying, and the proof asserts they survive wherever the plan claims
   `dataLoss: none`. The data-loss column of the safety report stops being
   a report and becomes a **verified claim**.

One failure class remains invisible to any state-based proof: the
**convergent-but-non-minimal** plan (rebuilding an index unnecessarily loses
nothing and converges fine — it is merely catastrophic on a 2 TB table).
Minimality is asserted at the plan level — semantic assertions on action
kinds and budgets, never on SQL bytes — in the test architecture (§4.3).

The proof loop inverts the correctness economy of the whole project:

- **In CI**: it is the universal oracle behind both the scenario corpus and
  the generative engine (§4.3).
- **In production**: proof-on-shadow is an optional pre-apply step for
  high-stakes targets.
- **For the rule table**: rules that misdeclare cascades, alterability, or
  data-loss classes are caught as proof failures the day they are written,
  not as field bugs.

Two safety fields need verification of their own, because state proof
cannot see them: **rewrite risk** is checked observationally on the clone
(a table whose `relfilenode` changed under an action that claimed no
rewrite is a failed proof), and **lock classes** are not provable by
outcome at all — they come from a vetted static table (PostgreSQL's
documented lock levels per DDL form) with targeted assertions, and the plan
presents them as *reported*, not certified.

### 3.8 Execution

Sequential, lock-aware, segmented: actions self-declare transactionality, so
the executor groups maximal transactional runs and isolates the exceptions
(`CREATE INDEX CONCURRENTLY`, …) instead of today's all-or-nothing single
concatenated script
(`apply.ts:125-131`, with its
own `TODO` admitting the gap at
`apply.ts:122`). Parallel DDL
execution stays rejected — `ACCESS EXCLUSIVE` locks make it a deadlock
machine, and the transaction is the atomicity contract. Per-statement error
attribution replaces the joined-string megaquery.

### 3.9 Integrations: a policy layer over deltas

Vendor-specific behavior (the Supabase integration today) is policy, not
engine: it decides *which* deltas a user sees and *how* actions render —
never how state is captured, diffed, or ordered. The policy layer has three
instruments, all data:

- **Filtering = predicates over deltas and facts.** A filter rule matches
  delta fields (kind, verb, identity) and fact context — including the
  provenance edges of §3.1. "Hide everything owned by extension X" or
  "never touch schema `auth`" become provenance/identity predicates instead
  of extraction-time suppression: the engine sees everything; policy decides
  visibility. The DSL is designed fresh for the fact model — typed
  predicates over fact kinds, identities, provenance edges, and delta
  verbs. What carries over from the current DSL is its proven *evaluation
  model* (declarative rules, first-match-wins), not its pattern syntax.
- **Serialization options = rule parameterization.** Options like
  `skipAuthorization` stop being per-change-class plumbing and become named
  parameters that a serialize rule passes into the rule table's templates.
- **Baselines = fact-base subtraction.** An "empty catalog" for a managed
  platform (what a fresh Supabase project already contains) is just a fact
  base; "diff against the platform baseline" is set subtraction before
  planning, replacing hand-maintained empty-catalog special cases.

A vendor integration is therefore a data package: predicates + rule
parameters + a baseline snapshot. It is versioned, authored without touching
engine code, and tested with the same proof harness (policy scenarios in the
corpus, §4.3).

---

## 4. Capabilities the design unlocks

These are not cleanups — they are features the current architecture cannot
express:

### 4.1 Rename detection, down to sub-entities

Content addressing makes renames visible at every grain: a fact removed on
one side and added on the other **with the same content hash** is a rename
candidate. At object grain that means `ALTER TABLE … RENAME TO`
(data-preserving) instead of drop+create (data-destroying). At fact grain it
extends to the case that destroys data in practice: **column renames** —
same payload hash, same parent, different name. Governed by policy
(`auto` / `prompt` / `off`), since hash-equality is necessary but not
sufficient evidence of intent. Every tool in this class punts on renames;
here they fall out of the state representation.

The mechanics depend on two §3.1 properties. Payload hashes are
identity-free (a fact's own name lives in its `id`, not in what is hashed),
so renaming a leaf changes its ID but not its hash. For *container* renames
— a renamed table changes every child's stable ID — matching uses the
identity-free **structural rollup**: payload hashes folded over the subtree
without any names, so the whole renamed subtree still matches. Honest
limit: payloads that reference *other* objects by name (an FK constraint
naming its referenced table) break hash-equality transitively, so detection
is strongest at the leaf and degrades gracefully — an undetected rename
falls back to today's drop+create behavior, never the reverse.

### 4.2 Proof-certified plans

"This plan was applied to a clone, produced a hash-identical desired state,
and preserved seeded data everywhere it claimed to" is a product claim no
comparable tool makes. It also gives drift
detection for free: comparing any environment against any snapshot is a
rollup-hash walk.

### 4.3 Tests as data: one harness, a seed corpus, a generative engine

The test architecture is P2 applied to testing itself: **one proof harness
(machinery) + scenarios (data)**.

- **The seed corpus.** Every scenario is a named
  `(DDL_A, DDL_B[, seed rows][, plan assertions])` fixture run through the
  proof harness. The existing integration suite ports into this corpus
  nearly mechanically — its dominant pattern (set up two databases, plan,
  apply, assert convergence) already *is* the proof loop, hand-rolled per
  test. What the corpus preserves is not the old assertions but the
  **problem corpus**: every field-discovered edge case and PostgreSQL
  semantic the project has been burned by — publication/FK-cycle drops,
  policy recreation chains, attnum drift, partition juggling. After the
  extractor SQL, it is the second most valuable asset in the repository,
  and it is exactly what a greenfield engine would otherwise silently
  regress on. The RED→GREEN discipline carries over: every new field bug
  becomes a corpus entry that fails before the fix and is pinned forever
  after.
- **The generative engine.** Property-based testing explores beyond the
  corpus: generate schemas, generate mutations, roundtrip through the proof
  loop — including the data-preservation check (§3.7) — and assert
  fixpoint. Coverage grows with compute, not with test-authoring effort;
  the corpus pins old ground so generation never re-loses it (the fuzzing
  model: seed corpus + exploration).
- **Semantic plan assertions.** Where a scenario's point is *how* the goal
  is reached — minimality, in-place alteration, risk class — the fixture
  asserts action kinds and budgets ("this delta yields an `alter`-class
  action, not a replace"; "≤ N actions"), never SQL bytes. Byte snapshots
  die with the old engine: they assert emission shape, which decomposition
  (§3.5) intentionally changes and the compactor may change again.
- **Differential testing until cutover.** Until retired, the old engine
  is itself an oracle: run both engines over the corpus and assert
  state-equivalent plans. Every divergence is a bug in one of them — and
  either finding is valuable.
- **An independent extractor ring.** The proof loop reads both sides
  through the same extractor, so an extractor blind spot (an unmodeled
  reloption, a missed catalog field) passes proof **vacuously** — both
  catalogs are equally blind. Two defenses: extraction fixture tests that
  pin specific catalog facts per PG version (these survive from today),
  and **pg_dump as an independent observer** — in CI proof runs, the
  schema dumps of two states the proof calls equal must also be equal; a
  divergence is an extractor gap found by a tool this project does not
  maintain.

What this replaces: the hand-written per-type matrix as the primary safety
net (127 unit-test files / 18,505 LOC in `objects/` die with the structures
they assert; 63 integration files × 3 PG versions × 15 CI shards = 45 jobs
collapse into corpus entries behind one harness). What survives unchanged:
extraction tests and catalog baselines (the extractor corpus survives, so
its tests do), and the Supabase integration tests (they assert filtering
policy, not engine behavior).

### 4.4 An honest role for static analysis

pg-topo exits the trusted path and becomes the developer-experience layer it
is genuinely good at: instant editor feedback, file ordering for humans
authoring declarative schemas, lint, cycle diagnostics. Its approximate
`ObjectRef` identity stops needing to agree with the exact engine, because
nothing downstream depends on it. (Consequence: the libpg-query WASM
dependency leaves the core install —
[package.json:80-89](../../packages/pg-delta/package.json) currently forces it
on every consumer.) The dev layer is today's pg-topo continuing as-is; its
evolution is deliberately **outside the staged build** (§9) — stage 7 treats
it as an optional, degradable assist, never a dependency.

#### 4.4.1 Statement reordering assist for shadow loading

**Context.** The shadow loader (§3.2) is parser-free by design: it sequences
*files* into the shadow in bounded retry rounds (a whole file is one
transaction, applied in textual order). That tolerates **cross-file** disorder
— a file is retried after the files it depends on build — but it cannot reorder
statements *within* a file. So `CREATE VIEW v …;` authored before
`CREATE TABLE t …;` **in the same file** never converges (the file is one
transaction and always fails the same way), and inline mutual foreign keys
across files need a manual `ALTER TABLE … ADD CONSTRAINT` split. The old
`pg-delta declarative-apply` avoided this by flattening every file into
statements and topologically sorting them — exactly the DX the declarative
workflow exists to provide, and a regression in the rewrite.

**Decision.** Restore "author in any internal order, any split, it still loads"
**without** putting a parser back in the trusted path:

- The fix is the **split**, not the sort. Splitting a file into one-statement
  units already removes the intra-file regression, because the loader's
  defer-and-retry rounds float a `CREATE VIEW` after its `CREATE TABLE` either
  way. The topological pre-sort is only an optimization on top: fewer rounds, a
  deterministic first pass, and cycle diagnostics.
- The assist returns **one statement per `SqlFile`** with a zero-padded ordinal
  name prefix (`0007__schema/users.sql`). Fed that, the existing loader becomes
  statement-granular with **zero core change** — its rounds, transaction-control
  rejection, non-transactional handling, and mutual-FK hint all carry over (a
  caller that lex-sorts by name keeps the assist's order). The loader cannot
  tell it was fed sorted statements.
- Every input statement is preserved **exactly once** — including statements the
  analyzer cannot classify and statements trapped in a cycle (the analyzer's
  ordered output is a *total* order; cycle members land at a best-effort
  position rather than being dropped). Statement text is carried **verbatim**;
  output is **deterministic** for the same input.

**Trust posture.** The assist is the developer-experience layer of §4.4, not a
trusted component. pg-topo is loaded through a guarded dynamic `import()` and
declared an *optional peer dependency*; merely importing the core never pulls
the libpg-query WASM parser — only calling the `@supabase/pg-delta/sql-order`
subpath does. In pg-delta's own CLI the assist is **escalate-on-failure**:
`schema apply` loads in the export manifest's `loadOrder` (else lexicographic
path order) first, reconnects once on a poisoned session, and only then reorders —
file-kind, then statement-kind — with a warning naming what to move
(`--no-reorder` disables only the reordering stages; the one-time reconnect
still applies); other
consumers (supabase/cli) opt in by adding pg-topo themselves and calling the
subpath.
When the peer is absent the subpath throws a typed `ReorderUnavailableError`
with an install hint (and `canReorder()` lets a caller probe instead of catch).

**Failure UX.** On a non-converging load the shadow's real Postgres errors are
authoritative. When the assist ran and flagged a **shadow-load cycle**, its
members are attached as a clearly-labeled, advisory static-analysis hint
(`suspected cycle a → b → a`) on top of the PG error — the assist annotates a
failure Postgres already produced, it never decides the load failed. A separate
`schema lint` command surfaces the analyzer's diagnostics for proactive
authoring, deliberately kept **out of the apply path** so apply stays
Postgres-truth.

**Consequences.** Correctness lives in the split plus the shadow's rounds; the
assist can degrade to nothing (uninstalled, or `--no-reorder`) and the loader
still works at file granularity. The only state the design must guard against —
the subpath imported without the peer declared — is covered by the guarded
import and the typed error.

**Alternatives rejected.** A `preserveOrder` flag on the loader (rejected: keep
the core blind to whether input was sorted; the ordinal name convention carries
order instead). A separate package that structurally guarantees pg-topo
(rejected: one guarded subpath plus a typed error already covers the only bad
state). Re-parsing `pg_get_expr()`-style output to recover references in the
trusted path (rejected by P1; the assist is dev-layer only).

### 4.5 Packaging that falls out instead of being debated

The architecture induces the package shape: a lean core (`pg`, `zod`-class
deps only) exposing the layers — fact base / diff / plan / proof / apply —
as independently usable entry points; pg-topo as a dev tool; the CLI as a
consumer of the public API. No further package engineering is required to
get a WASM-free, embeddable core.

Two clarifications so the dependency story is airtight: the `pgdelta`
binary ships from the CLI package, **not** from the core library — making
pg-topo optional can never strand a CLI user, because no install that
provides the binary lacks its dependencies. And the north-star declarative
path needs no pg-topo at all (the shadow frontend replaced the
static-analysis engine, §3.2); only explicitly dev-facing commands (lint,
file-ordering help) touch it, and those degrade with a clear install hint
rather than failing obscurely.

The new library ships as a new major (or a new package name — a product
decision, not an architectural one). The existing library enters
maintenance and is retired at the cutover bar (§9).

---

## 5. Imported assets: what the new library takes from the old

This is a clean-room build, but not amnesia. The old system's *knowledge*
is imported as data and SQL; none of its *mechanisms* — and none of its
*formats* — constrain the new design:

- **The extractor SQL corpus** (`<type>.model.ts` queries) — years of
  accumulated `pg_catalog` knowledge across PG versions; the single most
  valuable asset in the repository. It becomes the fact producer; what
  changes is the keying of its output (fact rows instead of nested
  documents), not its content.
- **The integration scenario corpus** — the distilled record of every
  field-discovered failure, and the second most valuable asset after the
  extractor SQL. The scenarios survive as seed-corpus fixtures for the
  proof harness (§4.3); only their implementation-coupled assertions and
  byte-level SQL snapshots are retired.
- **The `pg_depend` doctrine** — deepened from "the diff path's source of
  truth" to "the only semantic engine, period" (P1).
- **The normalization knowledge** in `stableSnapshot()` overrides (physical
  attnums vs logical names, canonical `pg_get_*def()` comparison forms) —
  it becomes the fact payload normalization, i.e. the content-hash surface.
- **Stable identity** as a concept — redesigned, not carried: structured
  end-to-end, with a version-tagged canonical encoding used only in
  persisted artifacts (§3.1). Nothing about today's string format is
  retained.
- **The plan + fingerprint product contract** — the *concept* is kept
  (plans as reviewable, version-controllable artifacts with drift
  detection); the format is new: ordered deltas plus rollup-hash
  fingerprints, version-tagged from v1.
- **Safety/risk classification** — generalized into per-action metadata
  supplied by the rule table.
- **Policy-as-data for integrations** — the filter/serialize DSL's proven
  ideas (declarative rules, first-match-wins evaluation) are kept; the
  surface itself is redesigned for facts and deltas with no compatibility
  with the old pattern syntax; specified in §3.9.

## 6. What is retired

| Retired | Replaced by |
|---|---|
| Document-shaped catalog models (columns/constraints/privileges/labels nested in `dataFields`, `table.model.ts:211-230`) | normalized fact rows with parent relations + Merkle rollups (§3.1) |
| 21 per-type diff functions + 106 change classes (256 files / 31,162 LOC) | rollup-guided generic diff + rule table (§3.3–3.4) |
| Per-type comment/privilege/security-label implementations (the "scope" axis) | one global rule per metadata kind over target-referencing facts (§3.4) |
| Two-phase sort + `invalidates` side channel + cycle breakers + dependency filter + post-diff normalization-as-repair | one mixed graph, decomposition by construction, cosmetic compaction (§3.5–3.6) |
| Round-based declarative apply (`round-apply.ts`) | shadow-DB elaboration through the one plan path (§3.2) |
| pg-topo in the apply path | pg-topo as dev-experience layer (§4.4) |
| String stable-ID re-parsing (`expand-replace-dependencies.ts:419-425`) | typed `StableId` (§3.1) |
| `JSON.stringify` equality + triple extraction per apply | content hashes + single-snapshot extraction + proof-as-opt-in (§3.1, §3.2, §3.7) |
| Hand-written per-type test matrix as primary safety net; byte-level SQL snapshots | one proof harness over the seed scenario corpus + generative exploration + semantic plan assertions (§4.3) |

## 7. Honest costs

- **Shadow DB requirement.** The SQL-file frontend and the proof loop need a
  reachable Postgres. Template-cloned databases make it cheap; embedded
  options (PGlite) may eventually make it serverless, but extension and
  version parity rule it out of the trusted path today. Environments that
  cannot reach any scratch database lose the declarative frontend — that is
  a real constraint and is accepted.
- **Fact-count growth.** Normalization multiplies object count ~10–30× (a
  10k-table schema becomes a few hundred thousand facts). Memory impact is
  trivial; diff cost tracks *changes*, not facts, because of rollup
  skipping. The real cost is conceptual: contributors think in facts and
  views instead of convenient pre-joined documents.
- **Rule-table expressiveness risk.** The gnarliest ALTER semantics resist
  tabularization; rules can degenerate into code-in-disguise. Mitigations:
  functions confined to predicate/template slots, delta-set rules for
  multi-fact atoms, and the proof loop as a lie detector. If a kind
  genuinely cannot be expressed, the honest response is a structured
  sub-rule vocabulary, not an imperative escape hatch — escape hatches are
  how the current eight-forms situation happened.
- **Verbosity when compaction is conservative.** Cosmetic by construction;
  the compactor can improve forever without correctness risk.
- **Proof costs an extra apply + extract.** Optional per environment; cheap
  with templates and hashes.
- **`pg_depend` does not see routine bodies.** PL/pgSQL and string-literal
  `LANGUAGE SQL` bodies are opaque to Postgres's dependency tracking (only
  SQL-standard `BEGIN ATOMIC` bodies get edges), so the graph cannot order
  a routine after a table its body references. The strategy is layered:
  routine-touching plans run with `check_function_bodies = off` (a
  preamble entry, omitted as a cosmetic compaction when no
  routine-family object is involved — `src/plan/preamble.ts`); PL/pgSQL
  is late-bound at runtime, so missing edges rarely matter for it;
  SQL-language ordering gaps surface in the proof loop as a failed clone
  apply — before production, not in it; and the dev layer (§4.4) can lint
  bodies for ordering hints. What is explicitly not done: re-parsing
  bodies in the trusted path to synthesize edges (P1).
- **Consumers migrate once.** A clean-room library means a new major: new
  API, new plan/snapshot formats (version-tagged), new SQL output shape.
  There is no in-place compatibility layer — that is the point. The cost
  is bounded by the cutover bar (§9): the old library keeps working, in
  maintenance, until the new one has proven itself against the corpus, the
  differential oracle, and the generative soak. **State equivalence —
  never byte equivalence — is the invariant throughout.**

## 8. Why the current design cannot simply be tuned into this

The findings below (all verified at `115dde8`) are not isolated bugs — each
is a direct consequence of an architectural commitment the north star
removes. (Findings are cited elsewhere in this document as §8.1–§8.7.)

1. **No shared extraction snapshot** (consistency bug) — consequence of
   extraction being a query fan-out rather than a state capture. §3.2.
2. **O(n²)-flavored equality and sort costs**
   (`base.model.ts:70-75`,
   `graph-builder.ts:26`,
   `topological-sort.ts:33-52`)
   — consequence of state not being content-addressed and the graph being
   rebuilt as repair. §3.1, §3.6.
3. **31K LOC of structurally identical per-type code** — consequence of
   knowledge-in-eight-forms; every object type re-states the same machinery.
   §3.4 / P2.
4. **A growing cycle-breaker registry, each entry a field-discovered bug** —
   consequence of compact-by-default emission + repair-on-detection. §3.5.
5. **Three semantic engines that must agree but cannot** (exact catalog,
   approximate parser, retry loop) — consequence of not committing to P1.
   §3.2, §4.4.
6. **45-job CI matrix defending hand-written cases** — consequence of
   lacking a proof loop; correctness must be asserted per-case because it
   cannot be checked per-run. §3.7.
7. **Three granularities that don't agree.** Equality lives at the document
   level (`dataFields` nests columns, constraints, privileges, labels —
   `table.model.ts:211-230`),
   dependencies live at the sub-entity level (`pg_depend` targets columns
   and constraints), and actions live at the statement level. Most
   hand-written code is translation between the three:
   `table.create.ts:36-43`
   re-enumerates column IDs out of the nested array so the graph can see
   them; the graph builder maintains reverse multimaps to map IDs back onto
   changes; and the 1,034 lines of
   `table.diff.ts`
   exist to re-discover *which nested part* of a "changed" document actually
   changed — a second, per-type diff engine inside each document. The fact
   base removes the translation by removing the disagreement: one
   granularity for state, dependencies, deltas, and actions. §3.1, §3.3.

## 9. The path: build clean, prove against old, cut over

The new library is built **clean-room beside the old one**. No engine code
is shared. The old engine has exactly two roles: *asset donor* (extractor
SQL, normalization knowledge, scenario corpus, safety tables — §5) and
*differential oracle* (it runs unmodified next to the new engine until
cutover). There are no byte-compatibility gates anywhere — every stage
ships behind proof-based gates only. Repository discipline (changesets,
RED→GREEN regressions) applies as usual.

Each stage's build — deliverables, old-codebase mining maps, pitfalls, and the
gate in checkable form — is recorded in [the build log](../build-log.md).

| # | Stage | Builds | Gate |
|---|---|---|---|
| 0 | **The red test suite, first**: scenario corpus ported from the existing integration tests; target API as typed stubs; fixture-validity layer green from day one; engine tests red on `NotImplementedError`, pinned by an explicit list; old-engine baselines captured | §4.3 | Fixture validity green on all PG versions; 100% of old integration files accounted for; every red explained |
| 1 | Identity codec + fact-base core: typed IDs, identity-free payload hashing, Merkle rollups (facts + edges), snapshot format v1 (version-tagged) | §3.1 | Property tests: codec round-trip, rollup algebra, hash stability |
| 2 | Extractor port: re-key the extractor SQL corpus to return structured identity parts and fact rows + edges; snapshot-consistent parallel capture | §3.1–3.2 | Extractor fixture ring per PG version; pg_dump observer; content cross-check against old-engine catalogs |
| 3 | Proof harness + corpus: `provePlan` (state + data-preservation checks; template-clone materialization — the render-from-fact-base form lands in stage 6); port the integration scenarios as the seed corpus; stand up the differential runner against the old engine | §3.7, §4.3 | Harness proves extract → clone → re-extract fidelity and snapshot round-trips over the corpus |
| 4 | Generic diff: rollup-guided descent emitting fact and edge deltas | §3.3 | Fixture diffs; `diff(A, A) = ∅` generatively |
| 5 | The planner: rule table, atomic actions, one-graph sort, compaction | §3.4–3.6 | Corpus green under proof; differential vs old engine (state-equivalent plans, divergences triaged); generative soak; zero cycles |
| 6 | Execution + plan artifact v1: ordered deltas, rollup-hash fingerprints, safety report (proven / observed / vetted tiers) | §3.7–3.8 | End-to-end proof on the corpus, including segmented non-transactional actions |
| 7 | Frontends: shadow-DB SQL loader (fail-safe ordering, body validation, cluster isolation, DML detection); snapshot frontend | §3.2 | Declarative scenarios in the corpus; loader detection/exemption tests |
| 8 | Policy layer: DSL v2 over facts/deltas; Supabase integration as a data package with platform baseline | §3.9 | Policy scenarios; baseline-subtraction proof against a real platform image |
| 9 | Renames (leaf + structural-rollup matching, policy-gated); declarative export; drift detection surfaced; public API and CLI finalized | §4.1, §4.2, §4.5 | Rename corpus; export round-trip `load(export(fb)) ≡ fb`; API review |
| 10 | **Cutover at the parity bar**: full corpus green; differential clean-or-explained; generative soak quota met; extractor ring green on all supported PG versions. Old library enters maintenance; consumer migration guide ships | — | The parity bar itself |

**Supported PostgreSQL versions.** The build targets the set the old
engine's CI matrix tests today: **15, 17, 18** (16 is absent because the
current product never supported it; that is inherited, not re-decided).
Adding or retiring a version is a product decision recorded in this decision
log; mechanically it is P2's promise — extraction-query updates, rules, and
a new fixture-ring lane (stage 2 owns the lanes; stage 10's bar runs on the
then-current set).

Stage 0 builds the definition of done before any engine code exists — the
corpus is the contract, and "all red" is sound because red is pinned to
mean *engine missing*, never *fixture broken* (the fixture layer is green
from day one). Stages 1–4 are bottom-up construction with no user-visible
surface; 5–6 are the engine; 7–9 are the product; 10 is the switch. The old
engine is never modified beyond what the differential runner needs.
Consumers migrate once, at cutover, to a new major — there is no in-place
compatibility layer.

## 10. Guardrails for implementers

This document will be executed stage by stage, likely by different people
and different agents, each holding only part of the context. The invariants
below are absolute. When one seems to block progress, the correct move is to
amend this document (with a decision-log entry) — never to make a local
exception:

1. **Identity has exactly one codec.** Extraction SQL returns structured
   identity parts — it never synthesizes identity strings; only the
   library-side codec produces the canonical encoding, and every persisted
   artifact (snapshot, plan, fingerprint) carries a format version.
   Hand-building an identity string anywhere, TS or SQL, reintroduces the
   §8.7 disease. Formats are never frozen — they are versioned; freezing
   was the old library's constraint, not this one's.
2. **No static SQL parsing in the trusted path** — extraction, diffing,
   planning, proof, apply. If a feature seems to need a parser, it belongs
   in the dev-experience layer (§4.4) or the design is wrong (P1).
3. **No imperative escape hatches in the rule table.** If a kind cannot be
   expressed, extend the rule vocabulary with a structured sub-rule form and
   record it in the decision log. One escape hatch is how eight forms of
   knowledge happen again (P2).
4. **A cycle is always a rule or emission bug.** Fix the rule or decompose
   the emission. Adding a cycle breaker — any runtime repair of the graph —
   is forbidden (§3.5–3.6).
5. **No planner work before the proof harness exists** (stage 3 lands
   before stage 5 starts). The proof loop is the safety net; building the
   trapeze act first is not faster.
6. **Never assert SQL bytes in new tests.** Assert state (proof), data
   survival (proof), or action kinds/budgets (semantic plan assertions,
   §4.3). Byte assertions re-couple tests to emission shape.
7. **Gates are non-negotiable.** Every stage ships behind its §9 gate —
   proof, differential, fixture ring; never byte equivalence. Cutover
   happens only at the parity bar. Every behavior change carries a
   changeset and a RED→GREEN regression per repository policy.
8. **Granularity is one.** State, dependencies, deltas, and actions all live
   at fact grain. Any new structure that nests sub-entities back into
   documents — or any map that translates between grains — is §8.7
   returning.
9. **The proof loop is the arbiter.** A change that passes state +
   data-preservation proof over the corpus and the generative engine is
   presumed correct; a change that cannot be proven that way is presumed
   wrong, however plausible it looks.

This document wins conflicts. If implementation contact shows an invariant
is genuinely wrong, amend the document first — decision-log entry, then
code.

## 11. Decision log

- **2026-06-12 (a)** — This document supersedes the earlier
  incremental-roadmap framing of itself. The maintainer's direction: define
  the **technical optimum without regard to past choices**; it is the
  project's north star. Earlier scoping decisions made under the incremental
  framing (e.g. "moderate packaging") are superseded where this document
  derives a different answer; the shadow-DB convergence decision is
  unchanged and now central (P1).
- **2026-06-12 (b)** — Following maintainer review ("are the change-based
  data structures and captured data the optimum?"), the fact base is
  specified as **fully normalized with Merkle rollup hashing** (§3.1), the
  diff output as fact-level deltas (§3.3), and cross-cutting metadata as
  ordinary target-referencing facts. This unifies state, dependency, delta,
  and action granularity — the property that makes P2's "two forms of
  knowledge" structurally true (§8.7) — and extends rename detection to
  sub-entities (§4.1). The captured *data* (extractor SQL, normalization
  doctrine) is affirmed as correct; the reshaping concerns its keying, plus
  provenance (extension membership) captured as edge facts instead of
  extraction-time filtering.
- **2026-06-12 (c)** — Following maintainer review ("should we keep the
  current tests in some form?"), the test architecture is specified (§4.3):
  the integration suite's *scenarios* are kept as the seed corpus of the
  proof harness; their implementation-coupled assertions and byte-level SQL
  snapshots are not ported. The proof loop gains a **data-preservation
  check** (§3.7), closing the convergent-but-destructive blind spot of
  schema-state proof; convergent-but-non-minimal plans are covered by
  semantic plan assertions. The old engine serves as a differential oracle
  until retired.
- **2026-06-12 (d)** — Pre-handoff review: added the integration policy
  layer specification (§3.9) and the implementer guardrails (§10), in
  preparation for implementation planning being delegated phase by phase.
  The document is considered ready; further refinement happens through
  implementation contact and decision-log amendments.
- **2026-06-12 (e)** — External review (PR #297, 13 findings — all
  verified against the codebase; every *finding* accepted, one suggested
  *mitigation* replaced with a different fix, noted at the end):
  collision-resistant identity-free hashing with edges folded into rollups
  and `link`/`unlink` deltas (§3.1, §3.3); shadow-loader specifics —
  fail-safe ordering, restored body validation, cluster isolation for
  shared objects, parser-free DML rejection (§3.2); fact-base re-creation
  as the proof materialization for live sources, since `TEMPLATE` cloning
  requires a connection-free source (§3.7); narrowed safety-certification
  claims — data loss proven, rewrite risk observed via `relfilenode`, lock
  classes vetted-not-proven (§3.7); independent extractor ring with
  pg_dump as outside observer against vacuous proof (§4.3); rename
  mechanics via identity-free structural rollups with the
  cross-reference caveat (§4.1); CLI packaging clarification (§4.5);
  per-kind equality-surface policy with the extension-version example
  (§3.1); `pg_depend` routine-body blind-spot strategy (§7). One reviewer
  suggestion was rejected on technical grounds: a deep-compare fallback on
  hash matches would reinstate the full-compare cost on the unchanged
  majority — the accepted fix is a collision-resistant digest instead.
- **2026-06-12 (f)** — Maintainer direction: full breaking changes allowed;
  this is a **brand-new library**, not an evolution of the current one.
  Revised accordingly: the stable-ID wire format is no longer frozen —
  identity is structured end-to-end with a single library-side codec and
  version-tagged canonical encoding, and extraction SQL returns identity
  parts instead of synthesizing strings (§3.1, guardrail 1); the policy DSL
  is designed fresh for facts/deltas rather than carrying the old pattern
  syntax (§3.9); plan and snapshot formats are new and version-tagged
  (§5); §9 is rewritten from in-place migration phases to a clean-room
  build-and-cutover plan — byte-identical SQL gates are gone entirely,
  replaced by proof/differential/fixture gates; consumers migrate once, at
  the cutover parity bar (§7). Entries (a)–(e) above predate this and any
  in-place-migration framing in them is superseded.
- **2026-06-12 (g)** — Per-stage implementation documents authored
  (since consolidated into [the build log](../build-log.md)), and the
  path gained **stage 0** at the maintainer's suggestion: the test suite is
  built first — corpus ported from the existing integration tests, target
  API stubs, old-engine baselines — with one refinement: red must mean
  *engine missing* (pinned `NotImplementedError` list), never *fixture
  broken* (the fixture-validity layer is green from day one).
- **2026-06-12 (h)** — Final pre-handoff review (two independent audit
  passes over all 12 documents). Consistency fixes: §3.1 property count;
  §3.6 tie-break aligned with stage 5 (kind weight → canonical identity —
  no phase tier in a one-graph sort); §9 stage-3 row no longer overstates
  materialization (render-from-fact-base is stage 6); §9 stage-9 row gains
  export + drift; stage-doc dependency headers and wording corrected.
  Ownership gaps closed: drift detection (stage 9), the
  dangling-requirement-from-policy check (stage 5, graph build), the vetted
  lock-class table (stage 5), the ≥10k benchmark fixture (stage 5),
  generator-coverage growth (stage 5 + stage 10 bar), the new package's CI
  lane (stage 0), plan-artifact version rejection (stage 6), shared
  diagnostic type (stage 1), and the supported-PG-versions policy (§9).
  Rename-policy default is no longer open — stage 9 sets `prompt` (CLI) /
  `off` (library), revisit after field experience.
- Open questions intentionally left to their stages: compaction's default
  aggressiveness (stage 5), how aggressively to prune the ported corpus
  once generative coverage matures (stage 3), new-major vs new-package-name
  (stage 10, product decision).

---

## Appendix: baseline metrics (commit `115dde8`)

| Metric | Value |
|---|---|
| pg-delta source (src/) | ~88K LOC, ~511 files |
| `src/core/objects/` | 256 source files / 31,162 LOC; 127 test files / 18,505 LOC |
| Object-type directories / concrete change classes | 21 / 106 |
| `depend.ts` | 1,895 LOC, 2 functions, 30+ CTEs |
| `sort/` | ~4.6K LOC across 15 files (incl. 3 cycle breakers) |
| Integration tests | 63 files × 3 PG versions, 15 CI shards (45 jobs) |
| pg-topo source | ~4.4K LOC, 18 modules; 38 statement classes, 28 object kinds |
| Library hard deps | `pg`, `zod`, `@ts-safeql/sql-tag`, `picomatch`, `debug`, `@stricli/core`, `chalk`, `@supabase/pg-topo` (→ libpg-query WASM) |
