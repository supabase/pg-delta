# Post-v1 backlog

What comes *after* the correctness-first v1 cut (see [v1.md](v1.md)), in two
milestones — **performance**, then **DX & cutover** — plus the deliberate
deferrals. This consolidates the former per-item `tier-*` files into one tight
backlog; each entry is problem · approach · status, with Linear IDs where they
exist.

| Symbol | Meaning |
|---|---|
| ✅ | Shipped |
| 🟠 | Net-new engineering, ready to start |
| 🟡 | Substrate exists; build the consumer/surface |
| 🔴 | Net-new engineering, blocked on a decision |
| 🟢 | Validation / product / process (not new engine code) |
| ⚪ | Deliberate deferral (documented, regression-free) |

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

## Milestone B — DX & cutover

### 🟡 Risk classification 2.0
The engine already computes proof-verified per-action safety (`dataLoss`,
`rewriteRisk`, `lockClass`, `transactionality`). Derive stable `HazardKind` codes
from those fields, attach them to the plan artifact (additive), add an
`--allow-hazards` gate and a GitLab Code-Quality JSON reporter. CLI-1459–1464.

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
gaps. **Explicitly deferred from v1** (decision + rationale:
[v1-evidence.md](v1-evidence.md) Gate 5): the supabase policy's filter rules are
the v1 mechanism; the baseline adds long-tail platform coverage and
user-vs-platform disambiguation (e.g. a user-customized `ALTER ROLE postgres
SET …` could round-trip instead of being filtered wholesale, #371). To land:
commit `src/policy/baselines/supabase-baseline-<major>.json` for every
supported PG major (declared-but-unresolved fail-fasts, so partial coverage
bricks the profile) with regeneration tied to image bumps
(`scripts/generate-supabase-baseline.ts`); declare `baseline:
"supabase-baseline"` in `supabasePolicy`; resolve the baseline in `provePlan`
(else baseline-shaped plans drift at prove time — see the Gate 5 note) plus a
corpus/integration case; revisit the Phase 2b seed derivation (the
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

### 🟢 Stage-10 cutover
Switch consumers from the old engine at the **parity bar**: corpus 100% green,
zero untriaged differential divergences, generative soak at quota, extractor ring
green, performance parity, real-world shakedown, and the naming/deprecation
decision. Product/process, sequenced after v1 + perf.

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

See [../packages/pg-delta-next/COVERAGE.md](../../packages/pg-delta-next/COVERAGE.md)
for the authoritative catalog-coverage map.
