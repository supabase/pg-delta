# C1 — Prove compaction is not required for convergence

**Priority:** Medium–High · **Wave:** 3 (any time after V1) · **Ship:** one PR · **Depends on:** V1 preferred (prove.ts touch-points) · **Coordinate with:** P1/P3 on `tests/engine.test.ts` · **Conflicts with:** C2, H1 (`internal.ts`); V1/P2 only if `prove.ts` API is touched

> **Contract:** harness-only. Corpus builds **two plan artifacts** per
> scenario × direction (compact on/off) and proves/applies each end-to-end,
> with full per-mode teardown (drop DBs → `dropRolesExcept` → replay) on the
> serial lane. No default flips in this PR.

> **Scheduling note:** the old “after I1” dependency was inherited from the
> defaults-flipping design, which edited `plan.ts`/`prove.ts` gates. Dual-prove
> is harness-only, so it can — and preferably should — land **before I1**: I1’s
> mandatory full-corpus gate then validates rename scenarios under both compact
> modes, catching rename×compaction interactions when they are most likely to
> be introduced. Cost: I1’s corpus run goes from ~2.5 to ~5 min. Worth it.

## Goal

**Enforce** “compaction must not be required for convergence” in the corpus by
**dual-proving every scenario compact and uncompact**. Treat any default flip
for library/CLI as a **secondary** product decision, not the correctness fix.

## Why this track exists

`plan/internal.ts` (~992 LOC) runs multi-pass elision (`compact !== false` in
`plan/plan.ts`). Reviews: “cosmetic” ACL/ADP/policy elisions encode create-model
semantics; `--no-compact` vs compact can diverge in review while both claim to
prove. Compaction is a second planner on the hot path.

**Why not “just default uncompact for prove”?** If CLI users still emit and apply
compacted plans, and prove uses the same compact setting as the plan under test,
compaction remains on the user-facing correctness path. Flipping library/prove
defaults only changes which variant CI exercises — and can *reduce* coverage of
the path humans actually run. Dual-prove fixes the stated problem directly.

## Out of scope

- Rewriting every elision into rules (that’s C2)
- Identity normalize (I1)
- sql-format (K1)

## Owned files (write)

| Area | Paths |
|---|---|
| Corpus harness | `packages/pg-delta/tests/engine.test.ts` — dual prove loop |
| Plan options | `plan/plan.ts` only as needed to make compact on/off explicit and testable |
| Prove | `proof/prove.ts` only if harness needs a clean “prove this plan artifact” API |
| Docs | README / corpus note: both shapes must converge |

**Not in this PR:** CLI flags, library defaults, any product-behavior change.
Default flips are a **follow-up decision** taken after dual-prove is green —
this track is genuinely harness-only.

## Design requirements

### Primary (required)

1. **Corpus dual-prove:** for every scenario × direction, build **two plan
   artifacts** — `plan(…, { compact: true })` and `plan(…, { compact: false })`
   — and apply/prove **each artifact** end-to-end. Both must converge (state
   proof; data proof per existing coverage rules). Note: `compact` exists only
   at `plan()` time; `provePlan`/`apply` take the finished artifact
   (`prove.ts:379-384`, `apply.ts:112-116`) — there is no downstream compact
   setting to keep in sync, only "prove the artifact you apply."
2. Failure message must name scenario, direction, and which compact mode failed.
3. Cost: expect ~2× corpus wall time per PG version (~2–3 min → ~5 min on
   `postgres:17-alpine`). Acceptable; do not “optimize” by sampling unless CI
   matrix forces a documented shard strategy.
4. Each mode proves and applies **its own artifact** (no cross-wiring a compact
   plan with an uncompact proof or vice versa).
5. **Per-mode isolation for cluster-global state (roles).** The shared cluster
   has **no automatic role cleanup** (`tests/containers.ts:1-16`); role-DDL
   scenarios rely on a serial lane (`engine.test.ts` `mustRunSerially`,
   ~249-257) and never re-run today. Running the same scenario twice back-to-back
   collides on leftover role state. Between modes, do a **full teardown and
   replay**, in this order: drop the scenario's clone/shadow **databases first**
   (a role owning objects or holding grants in any live DB cannot be dropped),
   then `dropRolesExcept(baseline)` (`containers.ts:163-176`), then replay the
   scenario from its SQL for the second mode. Role-DDL scenarios stay on the
   serial lane. Resetting roles while scenario databases are still alive is
   **not** sufficient.

### Follow-up only (not this PR)

6. Product default for human CLI `plan` output may stay compacted; library
   embedders may choose either. Decide and document in a separate PR after
   dual-prove is green.
7. Whatever is decided, do **not** land a default flip that removes compact
   from CI coverage.

## RED → GREEN

1. **RED:** Harness runs dual-prove; if any scenario fails uncompact (or compact)
   today, that failure is the pin — fix planner/compaction or skip with issue
   link only if environmental.
2. **GREEN:** Dual-prove green on PG17 full corpus.
3. Run:
   ```bash
   cd packages/pg-delta
   bun test src/plan/internal.test.ts
   PGDELTA_TEST_IMAGE=postgres:17-alpine bun test tests/engine.test.ts
   ```

## Acceptance criteria

- [ ] Every corpus scenario proves under `compact: true` and `compact: false`
- [ ] Docs state compaction is a pretty-printer, not a correctness dependency
- [ ] Each mode's artifact proved and applied as-built (no cross-wiring)
- [ ] Changeset: none if harness/tests only; `patch` if `plan.ts`/`prove.ts`
      needed touching

## Conflicts / do not touch

- `role-rename-carry` / identity normalize
- Deep rewrite of individual elisions (C2)

## Done when

CI will fail if a future elision makes uncompacted (or compacted) plans diverge
from convergence; C2 can shrink elisions with a real safety net.
