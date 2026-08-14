# Backlog

The forward-looking plan for `@supabase/pg-delta`, in two milestones —
**performance**, then **DX** — plus the remaining validation work and the
deliberate deferrals. Each entry is problem · approach · status, with Linear IDs
where they exist.

| Symbol | Meaning |
|---|---|
| ✅ | Shipped |
| 🟠 | Net-new engineering, ready to start |
| 🟡 | Substrate exists; build the consumer/surface |
| 🔴 | Net-new engineering, blocked on a decision |
| 🟢 | Validation / product / process (not new engine code) |
| ⚪ | Deliberate deferral (documented, regression-free) |

---

## Validation — run the gates to green at scale

The correctness harness is green at CI defaults (corpus × PG 14–18 on every
push). These are the runs that go beyond CI defaults; none of them is new engine
code.

### 🟢 Generative soak at an agreed quota
Raise `PGDELTA_NEXT_SOAK` to a sustained run (`bun test tests/generative.test.ts`)
and record it green — zero proof failures, zero cycles, zero crashes. The quota
itself still needs to be set.

### 🟢 Real-world shakedown
Put at least one large, anonymized, production-shaped schema through `plan` +
`prove`. The corpus is broad but synthetic; this is the first contact with a
schema nobody designed for the test suite.

### 🟠 Outside-observer verification gate
The proof loop re-extracts with the same engine that planned — a convergence
check, not an independent one: a blind spot shared by extractor and planner
(e.g. an unextracted attribute) is invisible to it by construction. Add an
independent observer: after apply, compare source vs target through a tool that
shares no code with pg-delta (normalized `pg_dump --schema-only`, or a second
minimal extractor). Surfaced as P3 in the 2026-08 old-engine differential
review (see the triage in
[pg-delta-next-follow-ups.md](pg-delta-next-follow-ups.md)) — the review
itself played this role manually.

### 🟢 Publish the scope statement
A user-facing statement of what the engine manages and what it deliberately does
not, derived from
[`COVERAGE.md`](../../packages/pg-delta/COVERAGE.md) plus the `unmodeled_kind`
completeness diagnostic. The exclusions are already enforced and visible; this
writes them down where a user will find them.

---

## Milestone A — performance

### ✅ Dependency-resolver rewrite
A single correlated `pg_depend` resolver query was 86% of extraction. Rewriting
it set-based made it **7×** faster and `extract` **4.2×** faster overall
(1,881 → 453 ms cold on ~12k objects), with byte-identical edges. *Shipped*
(CLI-1603); recorded in [../build-log.md](../build-log.md).

### 🟠 Memory-optimal extraction & diff
The diff materializes both catalogs (held heap is lean ~660 B/fact, but the `pg`
driver buffers full result sets → transient peak is the OOM edge). Plan: make held
memory **O(changes)** via a two-pass hash-manifest → fetch-changed diff. **Phase 1**
(cursor-stream the unbounded extractors + a `maxFacts` guard) is low-risk and
independently shippable; the full manifest diff is gated on a real 250k+-object
catalog need.

### ⚪ Parallel snapshot extraction
Originally assumed the big win; re-profiling after the resolver rewrite showed it
would gain **< 2×** for a large, consistency-critical refactor (the resolver is
one unsplittable query that caps the ceiling). Deferred.

---

## Milestone B — DX

### 🟡 Schema-first CLI enablement
Promote engine primitives the RFC's `PgDeltaSchemaEngine` adapter needs onto
the exported library surface (stable `planId`, `HazardKind` codes, file
classification, segments, coverage/data-loss helpers, named loader options).
Most of the RFC's integration boundary is already satisfied; the work is
targeted additions plus moving CLI-only logic out of `src/cli/**`. Full plan
and WP sequencing plus per-slice status:
[schema-first-cli-enablement.md](schema-first-cli-enablement.md). Linear: the
RFC plus CLI-1459–1464 (WP2).

### 🟡 Risk classification 2.0
The engine already computes proof-verified per-action safety (`dataLoss`,
`rewriteRisk`, `lockClass`, `transactionality`). `HazardKind` codes are derived
as a view (`actionHazards` / `classifyPlanHazards`, WP2 #420) — never stored on
`Plan`/`Action` and not part of `planId`. Remaining: the `--allow-hazards` gate
and a GitLab Code-Quality JSON reporter in the Supabase CLI. CLI-1459–1464.

### 🟡 Migration squash / repair
Collapse a chain of migration files into one consolidated migration, and emit it
across multiple files respecting segment boundaries. Substrate exists
(`loadSqlFiles`, `plan`, `segmentActions`, ordered export); build the `squash` /
`repair` commands + multi-file output. CLI-1597, CLI-1598 (CLI-1424's
public-only limitation doesn't exist here by construction).

### 🟡 Object-filtering flags
Expose the policy DSL's filtering vocabulary as CLI flags (`--schema`,
`--exclude`). Thin consumer over existing predicates: flags → `Policy`, wire into
commands, report what was filtered. CLI-1006, CLI-1169, CLI-1432.

### 🟡 Typed auth / connection errors
Classify connection failures into typed errors with stable codes (`auth_failed`,
`host_unreachable`, `tls_error`, `timeout`, `db_not_found`) and redact
credentials from every message (redaction already done). CLI-1607.

### 🟡 Stripe Sync Engine reset
`db reset` fails when a local Stripe Sync Engine owns a schema. Engine lever
exists (mark the schema externally-managed: exclude via policy + drop FKs into
it); the container-sequencing half is Supabase-CLI work, out of this repo.
CLI-1582.

### 🟡 Applier-capability CLI wiring
Persistence is shipped (`plan --restrict-to-applier`); extend the capability
projection through the rest of the flow.

### 🟡 Supabase baseline snapshot
Baseline subtraction is fully built and fail-loud (`subtractBaseline`,
`resolveBaseline` with digest + redaction-mode validation, plan-side wiring, the
generator script) — what's missing is the committed artifact and two wiring
gaps.

**Why it was deferred rather than shipped.** The supabase policy's filter rules
are the correctness mechanism: every known platform object class is hidden by an
explicit rule (system schemas/roles/extensions, FDW ACLs, system-role ADPs, the
platform role plumbing incl. `supabase_privileged_role` and the `postgres` role
object, #371). The baseline is an *increment* over the filters — long-tail
platform state and user-vs-platform disambiguation (e.g. a user-customized
`ALTER ROLE postgres SET …` could round-trip instead of being filtered
wholesale) — not a replacement: subtraction only removes present-and-identical
facts, so version/image drift degrades gracefully back to the filters anyway.
Against that marginal value stand real prerequisites: per-PG-major committed
snapshots regenerated on every image bump (declared-but-unresolved fail-fasts,
so partial major coverage bricks the profile), prove-side wiring, and the
Phase 2b seed-derivation revisit.

**To land:** commit `src/policy/baselines/supabase-baseline-<major>.json` for
every supported PG major with regeneration tied to image bumps
(`scripts/generate-supabase-baseline.ts`); declare
`baseline: "supabase-baseline"` in `supabasePolicy`; **resolve the baseline in
`provePlan` too** — `plan()` subtracts it via `options.baseline`, but the proof
loop re-derives the view from `plan.policy` *without* one, so a baseline-shaped
plan would drift at prove time — plus a corpus/integration case proving a
baseline plan clean; revisit the Phase 2b seed derivation (the
`seed-assumed-schemas.test.ts` "non-empty seed" pin fails loudly if missed);
exercise subtraction in CI.

### ✅ Engine refactors (locality/allocation)
Cleanup items from the 2026-06-15 branch review (reverse-index rebuild,
`FactBase.getByEncoded`/`incomingEdges`, onboarding map, projected-emission seam,
extractor/rules split by family). The substantive items shipped; what remains is
deliberate non-decisions. Not bugs.

### 🔴 Extension-intent Phase B
Replay extension intent (`pgmq.create`, `cron.schedule`, `partman.create_parent`)
on a from-scratch rebuild. Phase A (no data loss) shipped; Phase B is
execution-ready but **blocked on the declarative-source-format decision**
(CLI-1431) and the per-extension intent matrix (CLI-1430). Full plan:
[extension-intent-phase-b.md](extension-intent-phase-b.md).

### ✅ Cutover
The legacy per-object-type engine was removed and the clean-room engine promoted
into `packages/pg-delta`, published as a breaking-change alpha under the same
name and `pgdelta` binary. *Shipped* (#299); the consumer-facing mapping is in
[`MIGRATION.md`](../../packages/pg-delta/MIGRATION.md).

---

## Parked architecture tracks

Reopen only on evidence, not as aesthetic cleanup:

- **Compaction shrink (C2)** — reopen only for a concrete compact/uncompact
  divergence, or a compaction elision implicated in a bug. The corpus already
  builds, applies, and proves both shapes for every scenario, so compaction is
  enforced as cosmetic; shrinking it further has no correctness gate behind it.
- **Declarative rule IR (H2)** — reopen only when one of its documented evidence
  conditions is met. The rule table is data-driven already; converting it to a
  fuller IR is a refactor in search of a failure.

---

## Designs parked for later

Full designs that are written but deliberately not yet implemented:

- **[ephemeral-shadow-design.md](ephemeral-shadow-design.md)** — auto-provision a
  throwaway shadow so `schema apply --shadow` becomes optional. Captures the
  cluster-global-DDL correctness tension and the recommended approach (isolated
  Docker container + baseline subtraction). The related round-cap fix already
  shipped.

---

## Deliberate deferrals (not blocking any milestone)

Documented, regression-free, each with a trigger to revisit:

- **Sub-entity & rare member-root provenance** — columns, constraints, indexes,
  triggers, policies, rules, plus FDW/server/foreign-table/event-trigger/
  publication are still filtered at extraction rather than carried as
  `memberOfExtension` facts.
- **Modeling rare kinds** — casts, operators (class/family), text-search,
  statistics, languages, transforms are *detected and reported* (the
  `unmodeled_kind` diagnostic), not modeled. Model them when a real schema needs
  it (CLI-690 is the canonical add-when-needed example).
- **Security-label CI prebuild** — the `dummy_seclabel` image builds on first run;
  prebuilding it in CI is an optimization.
- **PGlite in the trusted path** — not adopted; PostgreSQL remains the elaborator.
- **Column-inline `PRIMARY KEY` compaction** — compaction folds a co-created
  table's validated PK/UNIQUE/CHECK into the CREATE parens as a TABLE constraint
  (`CONSTRAINT name <def>`, the def verbatim), deliberately NOT onto the column
  line (`id bigint … primary key`). Three reasons, in order of weight:
  1. *The def is verbatim `pg_get_constraintdef` output, and the column-inline
     form requires rewriting it* — `PRIMARY KEY (id)` → `PRIMARY KEY` means
     parsing the def, confirming the column list is exactly this one column, and
     stripping it. That is the "semantically edit catalog-rendered SQL" class the
     engine bans; real defs like `PRIMARY KEY (id) INCLUDE (extra)`,
     `… DEFERRABLE INITIALLY DEFERRED`, `… WITH (fillfactor=70)`,
     `… USING INDEX TABLESPACE x` are where a naive strip emits wrong or invalid
     SQL. The table-constraint form uses the def byte-for-byte.
  2. *The fold machinery appends whole clauses; it never edits one* —
     `compactColumnFolds` splices independent clause strings into the CREATE
     parens. The column-inline form would mutate an already-spliced column
     clause inside the composed statement (string surgery with quoting/comma
     ambiguity the append-only design exists to avoid).
  3. *Single-column PKs only* — a composite PK must stay a table constraint, so
     both forms plus selection guards would live forever for a purely aesthetic
     delta. Both forms produce identical catalog state (same constraint name,
     same `attnotnull`), so extraction/fingerprint/proof cannot distinguish them.
  If ever revisited, the clean design is the canonical-render idiom (see
  `foldCoCreateOwnership`'s `schemaCreateSql` comparison): reconstruct the
  expected def from structured fields (`contype='p'`, single-entry `conkey`,
  replicating PG's `quote_ident` rules) and inline ONLY on a byte-exact match
  with the actual def, falling back to the parens form otherwise — prove the def
  is the trivial case, then render the inline form from structured data; never
  rewrite the def. Trigger to revisit: a concrete consumer for whom the parens
  form is insufficient — not aesthetics alone.

See [`COVERAGE.md`](../../packages/pg-delta/COVERAGE.md) for the authoritative
catalog-coverage map.
