# Build log — how the engine was rebuilt

A light record of the clean-room rebuild: the stages it was built in, the
hardening and review passes it went through, and the decisions made along the
way. It is a **history**, not a description of the present — for how the engine
works today, trust the code and [architecture/](architecture/).

> This consolidates what used to be ~20 separate stage/review files. The detailed
> originals live in git history if you need to dig; this is the map.

---

## Built in stages, test-first

The rebuild was executed as a sequence of gated stages — the test corpus and
proof harness were stood up *before* the engine, so correctness was measured from
day one rather than asserted after the fact.

| Stage | What it delivered |
|---|---|
| 0 — test suite | Scenario corpus, proof-harness contract, and differential baselines — red by design until the engine existed. |
| 1 — fact core | The typed data layer: stable-id codec, facts, edges, content hashing, Merkle rollups, snapshot format. |
| 2 — extractors | Catalog → fact base, captured in one consistent snapshot, with `pg_depend`-sourced dependency edges. |
| 3 — proof harness | The safety net: `provePlan`, the data-preservation and rewrite checks, the differential runner. |
| 4 — diff | The generic, rollup-guided, zero-per-kind diff emitting fact deltas. |
| 5 — planner | The rule table, atomic actions, the one mixed graph, the deterministic sort, and compaction. |
| 6 — execution | Plan artifact v1 (versioned, round-trippable) and the segmented, lock-aware, fingerprint-gated executor. |
| 7 — frontends | The shadow-DB `.sql` loader (bounded-round ordering) and the snapshot frontend. |
| 8 — policy | Policy DSL v2 (typed predicates, filter/serialize rules, baseline subtraction) and the Supabase package. |
| 9 — renames & API | Rename detection over structural rollups, the reviewed public API, and the CLI. |
| 10 — cutover | *Shipped* — the legacy engine removed, the clean-room engine promoted into `packages/pg-delta` and published as a breaking-change alpha. |

Result (rewrite-era snapshot at first engine-complete cut): **−79% source LOC,
one rule table instead of ~100 change classes, and a correctness guarantee the
old engine never had.** Current measured size (three budgets + corpus count)
lives in [overview.md](overview.md) §4 — do not treat the rewrite-era −79% as
today’s package total.

---

## Hardened against the north star

After the first end-to-end engine, an 8-item hardening pass closed the gaps
between the initial implementation and the target design — **all shipped**:

1. **Explicit projection** — plan/prove fingerprints derive from the *projected*
   desired state, not the raw one.
2. **Proof coverage** — proof reports per-table content modes
   (`fingerprint`/`count`/`none`) and deterministic fingerprints on seeded tables.
3. **Typed predicates** — `edgeKind` on edge predicates; `validatePolicy` rejects
   unknown id-fields.
4. **Satellite consistency + provenance flip** — a filtered object's satellites
   (comments, ACLs) filter with it; extension members are observed as facts with
   `memberOfExtension` edges and projected out by default (sub-entity and rare
   member kinds remain documented deferrals).
5. **Enum boundary** — `commitBoundaryAfter` unconditionally closes a segment
   (`ALTER TYPE … ADD VALUE` before its first consumer).
6. **SQL-file robustness** — per-file transactional wrapping with a
   non-transactional fallback.
7. **Planner split** — graph build, tie-break, compaction, and safety-report into
   their own module.
8. **Docs normalization** — coverage sorted into implemented / simplification /
   excluded buckets.

---

## Measured against the old engine

A triage of the **134 tracked issues** in the *database diffing 2.0* project
against the new engine found that the architecture *dissolves whole classes of
bug* rather than requiring per-issue fixes:

- **~90 resolved by construction, corpus, or policy** — the fact model, the
  one-graph sort, the single-snapshot extractor, the missing-requirement guard,
  and the proof loop close most field bugs structurally; the Supabase policy DSL
  handles the platform-specific cluster.
- **~13 substrate-ready** — the engine provides the mechanism; the consumer/CLI
  surface is the remaining work (now tracked in [roadmap/backlog.md](roadmap/backlog.md)).
- **One genuine design gap** — stateful-extension *intent*. Phase A (stop
  dropping extension-managed data) shipped; Phase B (replay on rebuild) is a
  scoped, blocked follow-up
  ([roadmap/extension-intent-phase-b.md](roadmap/extension-intent-phase-b.md)).

---

## Reviewed, repeatedly

The branch went through an independent **v1-readiness review** plus a rapid series
of **branch and follow-up reviews** over 2026-06-13 → 2026-06-16. The reviews were
adversarial and found real issues; **all correctness findings have shipped.** The
notable ones:

- **Unmodeled-kind detection** (the one P0 from the readiness review) — the
  extractor used to silently omit user objects in kinds it doesn't model (casts,
  operators, text-search, statistics, languages, transforms). Now a
  provenance-aware **catalog completeness check** reports them as `unmodeled_kind`
  diagnostics, and `--strict-coverage` refuses to act while they exist. *Shipped.*
- **Diagnostics surfaced + `Policy.baseline` fail-loud** — extraction diagnostics
  now print on every CLI command; a declared-but-unresolved baseline throws
  instead of silently no-op'ing. *Shipped.*
- **Projected-target planning** — action emission used the unprojected target and
  could reference filtered-out dependencies; emission now runs against the
  projected view. *Shipped.*
- **Rename + ownership correctness** — several edge cases where an accepted rename
  combined with an owner/role change dropped a role too early or formed a cycle;
  role-rename identity is now carried through owned objects. *Shipped.*
- **SQL loader hardening** — rejects self-managed transactions
  (`BEGIN`/`COMMIT`/`SAVEPOINT`, `BEGIN ATOMIC` bodies excepted) and fails loudly
  on round-budget exhaustion rather than loading partially. *Shipped.*

Remaining review items were optimizations (fewer DDL statements around role
renames) and deeper integration coverage, not correctness blockers — folded into
[roadmap/backlog.md](roadmap/backlog.md).

---

## Two architectural refinements that landed during review

- **The managed view** — scope, ownership, and applier capability were unified
  into one `resolveView` applied identically before plan and prove. This replaced
  the `skipSchema` / `skipAuthorization` escape-hatch parameters with catalog
  facts and ownership-as-edge.
  → [architecture/managed-view-architecture.md](architecture/managed-view-architecture.md)
- **Integration profiles** — `IntegrationProfile` / `ResolvedProfile` made "what
  the engine manages" a first-class object, threaded through extract → plan →
  prove → apply so the invariant *plan == prove == apply* holds by construction
  (and the plan artifact records the profile that produced it). *Shipped.*

---

## The first performance pass

Correctness was v1's gate, but profiling the extractor turned up a clean win: a
single correlated `pg_depend` resolver query was **86% of extraction time**.
Rewriting it set-based made the query **7× faster** and extraction **4.2× faster**
overall, with byte-identical output (gated by an edge-set oracle + the full
corpus on PG 14–18). Parallel snapshot extraction was *re-profiled and
deferred* — the resolver is now one unsplittable query that caps the parallel
ceiling below 2×. Details and the memory roadmap:
[roadmap/backlog.md](roadmap/backlog.md).

---

## Where things stand

The engine shipped as `@supabase/pg-delta` in a breaking-change alpha, replacing
the legacy engine outright. What remains is running the validation gates to
green *at scale* and publishing the scope statement — see
[roadmap/backlog.md](roadmap/backlog.md).
