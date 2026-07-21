# Agent tracks — architecture follow-ups

Detailed, delegation-ready briefs for the architecture work prioritized after
the Jul 2026 reviews. Each track is one agent / one PR unless the brief says
otherwise.

**Start here for review:** [OVERVIEW.md](OVERVIEW.md) — ELI5/ELI10, before/after
examples, and schematics for each big step.

**Commit this folder before delegating** — untracked briefs are invisible to
agents in fresh worktrees.

## Cross-links to live correctness backlog

This folder is scoped to **architecture hygiene** from the Jul reviews. It does
not replace the plan/apply fidelity backlog. When picking corpus pins or rename
scenarios, prefer concrete issues:

- [#332](https://github.com/supabase/pg-toolbelt/issues/332) — extraction/model fidelity gaps
- [#333](https://github.com/supabase/pg-toolbelt/issues/333) — plan/apply correctness gaps

Especially relevant to **P1** (known-bad action shapes) and **I1** (rename
identity scenarios).

## Dependency graph

```text
D0 (docs metrics) ─────────────────────────────────────────── anytime
P3 (autoSeed CI + seeder observability) ───────────────────── anytime (parallel with V1)
B1 (rename+policy cycle BUG) ──────────────────────────────── URGENT, parallel with V1
                                                              (crash-class; blocks I1)

V1 (reconstructManagedView) ──► I1a (normalizer) ──► I1b (integration)
                            └──► P1 / P2 / C1 may start after V1
                                 (respect conflict matrix)
B1 ─────────────────────────────► I1b (inherits scenario; deletes B1 carve-out)

V1 ──► C1 (dual-prove compact and uncompact) ──► C2 / H1
       C1 is harness-only — prefer landing it BEFORE I1b so I1's corpus
       gate validates both compact modes; single owner of
       tests/engine.test.ts (see rule below)

P1 parallel P3 after or beside V1; serialize P1 vs P2 on prove.ts
P2 (attributed projection audit) after V1 — two PRs: P2a attribution
   plumbing in policy/, P2b prove/CLI surfacing; owns prove.ts while open
   (P3 may touch only autoSeedEmptyTables — serialize, don't share)

tests/engine.test.ts has ONE OWNER at a time: C1 first; P1 and P3 stack
   on C1's branch or land strictly before/after — never three concurrent
   PRs into the harness file ("coordinate" was too weak)

H1 after C1 (file overlap with internal.ts)
H2 PARKED — evidence-gated, not scheduled
K1 RETIRED — boundary already exists; docs wording folded into D0
I2 docs anytime (avoid colliding with I1 identity docs)
```

## Parallel waves

Wave numbers are **conflict groupings, not strict chronology** — the
[Suggested first delegation](#suggested-first-delegation) section is the
authoritative order (notably: C1 preferably lands *before* I1).

| Wave | Ship together? | Tracks | Notes |
|---|---|---|---|
| 0 | Alone | [D0](D0-docs-metrics.md) | Parallel with anything; re-measure LOC/corpus at PR time; owns retired K1's wording |
| 1 | Separate PRs | [B1](B1-role-rename-policy-cycle.md), [V1](V1-reconstruct-managed-view.md) | B1 = urgent crash-class bug, parallel with V1 (disjoint files); V1 blocks I1/P2/C1 |
| 2 | **Two PRs** (I1a→I1b) | [I1](I1-prediff-rename-identity.md), optional [I2](I2-identity-invariants-docs.md) | I1a pure normalizer, I1b integration; needs B1 + V1; prefer C1 first; I2 docs-only parallel |
| 3 | Separate PRs | [P1](P1-action-shape-budgets.md), [P2](P2-unfiltered-drift.md) (P2a→P2b), [P3](P3-autoseed-ci.md), [C1](C1-compaction-split.md) | `engine.test.ts` single-owner: C1 first, P1/P3 stack or serialize; P1 vs P2 serialize on `prove.ts`; P3's seeder touch serializes with P2; prefer C1 before I1b |
| 4 | Alone | [C2](C2-compaction-shrink.md) | After C1; evidence-gated on a dual-prove divergence |
| 5 | Lint only | [H1](H1-planner-kind-lint.md) | After C1; per-file count ratchet |
| — | **Not scheduled** | [H2](H2-declarative-rule-ir.md) | Evidence-gated; do not delegate |
| — | **Retired** | [K1](K1-sql-format-boundary.md) | Boundary already exists (`./sql-format` subpath export); folded into D0 |

## Conflict matrix

| Track | Do not run in parallel with |
|---|---|
| B1 | I1; anyone on `internal.ts` ordering or `rules/policies.ts` |
| V1 | I1, C1, P2 (plan / prove / apply / export) |
| I1 | B1, V1, C1, H1; anyone on `role-rename-carry`, `change-set`, `action-emitter` |
| C1 | C2, H1 (`internal.ts`); P1/P3 on `engine.test.ts` — **single owner**: C1 first, P1/P3 stack on its branch or land strictly before/after; V1/P2 only if `prove.ts` API touched |
| P1 | C1/P3 on `engine.test.ts` (single owner — after C1 or stacked); **no P2 conflict** — P1 never touches `prove.ts` |
| P3 vs P2 | P3's `autoSeedEmptyTables` touch vs P2 owning `prove.ts` — serialize |
| D0, I2 | almost nothing |

## Suggested first delegation

1. **Agent A → B1** (urgent bug) and **Agent B → V1**, in parallel (disjoint files)
2. **Agent C → D0** (parallel with anything); **Agent D → P3** also fine now —
   but P3 must **land before C1 starts, or stack on C1's branch**
   (`engine.test.ts` single owner); don't open both the same day unstacked
3. After V1 (and P3 landed or stacked): **Agent E → C1** (dual-prove);
   parallel **Agent F → P1** (semantic budgets)
4. After B1 + V1: **Agent G → I1a** (pure normalizer, ships dark)
5. After C1 + I1a: **Agent H → I1b** (integration; corpus gate covers both
   compact modes); **P2a → P2b** any time after V1 as sole `prove.ts` owner

## Review amendments (2026-07-20)

Applied after codebase fact-check:

1. **I1** — pinned canonical direction = desired names; rename actions injected
   outside generic diff; RED must be behavioral (no relabel-pair churn), not
   "carry module absent."
2. **C1** — primary deliverable is corpus **dual-prove** compact and uncompact;
   default flips are secondary.
3. **P2** — unfiltered drift = baseline-subtracted catalog (not raw extract).
4. **H2** — parked / evidence-gated.
5. **V1** — only four full composition sites; diff/seed stay resolveView-only.
6. **P1** — semantic budgets first; drop count budgets as primary.
7. **P3** — no V1 dependency.

Second pass (same day), after verifying rename mechanics in code:

8. **I1** — corrected: rename actions are **already** synthesized from
   `acceptedRenames` in `plan/phases/action-emitter.ts` (~180–194); the brief
   now says *keep that seam* (feed it pre-rewrite from-facts, pin the
   `produces`=new-subtree ordering) instead of presenting injection as new
   machinery. Dropped the erroneous `prove.ts` "renamedTables will simplify"
   owned-file entry — that map is table/matview-only (roles filtered out) and
   out of I1's scope.
9. **C1** — unblocked from I1 (that dependency was inherited from the old
   defaults-flipping design); moved to wave 3, harness-only, prefer landing
   **before** I1 so I1's corpus gate validates both compact modes.

Third pass (same day), after adversarial cross-review + live reproduction:

10. **B1 (new)** — role rename + RLS policy referencing that role is a
    **confirmed crash-class planner bug** on main (dependency cycle between
    the rename and `ALTER POLICY … TO`; reproduced with an in-memory fixture;
    zero corpus/integration coverage existed). Urgent bugfix track, before I1.
11. **I1** — payload-carried role refs (`policy.roles`) moved **in scope**
    (B1 proved they are not harmless residual); added discovery-diff decision
    (`matchRenameCandidates` consumes diff remove/add pairs — two diffs by
    design); added physical-vs-canonical source decision (fingerprint/apply
    gate must use the un-rewritten view); split into I1a (normalizer) + I1b
    (integration); fixed leftover "injection"/"unblocks C1" contradictions.
12. **C1** — per-mode isolation specified: full teardown (drop scenario DBs
    **first**, then `dropRolesExcept`, then replay) on the serial lane;
    default flips removed from the PR entirely (follow-up only).
13. **P2** — reframed as **attributed projection audit** (stage/rule
    attribution + acknowledged-vs-suspicious); unattributed drift diffs
    (raw, baseline-only, residue) all rejected as perpetually noisy.
14. **P3** — seeder observability mandated first: empty catch at
    `prove.ts:257-263` swallows insert failures; per-table seed outcomes +
    coverage contract.
15. **V1** — helper kept internal (no package-index export; `ResolvedProfile`
    stays the public surface); identity assertion corrected (`resolveView` is
    identity only with no extension members / `managedBy` provenance — pin is
    byte-identical output, not raw-FB identity).
16. **H1** — file allowlist replaced with per-file baseline **count ratchet**
    (~79 existing kind-checks make a file allowlist toothless).
17. **C2** — evidence-gated on a dual-prove divergence; cross-action folding
    passes stay pretty-only (cannot be per-kind rules).
18. **K1** — retired: `./sql-format` subpath export already exists and the
    root index does not re-export it; remaining docs wording folded into D0.

Fourth pass (2026-07-21), after two further cross-reviews (all checkable
claims verified in code):

19. **I1** — pipeline pins `filterDeltas` on **both** diff passes (rename
    proposals come from policy-**kept** deltas, `change-set.ts:141-162`);
    fingerprint routing pinned (only `source.fingerprint` from
    `physicalSource`; canonical feeds everything else incl. desired-side
    fingerprint); scope pinned to **role renames only** (object-rename
    worklist cancellation stays); I1b owns a corpus `renames` opt-in —
    the corpus plans with renames **off** today (`engine.test.ts:50`), so
    "corpus green" pins no rename behavior; I1b acceptance now requires B1's
    carve-out removed or proven dead.
20. **P2** — split P2a (attribution plumbing) / P2b (surfacing); unit of
    attribution is the **suppressed delta/state**, not the dropped fact
    (reference-only payload suppression, independent edge pruning, and the
    previously missing `managedBy` stage); stable reason codes + descendant
    attribution; audit computed at **plan time** (`provePlan` has no raw
    source FB).
21. **P1** — action vocabulary pinned: verbs are only `create|alter|drop`
    (no `replace`; renames emit as `alter`), so budgets speak derived
    replacement/rename predicates and evaluate the **uncompacted** artifact.
22. **P3** — SQLSTATE-based skipped/failed taxonomy; allowlist keyed
    `{scenario, direction, table, reasonCode}`; strict on unknown errors.
23. **B1** — primary RED is a focused `renames: "auto"` test (corpus cannot
    express renames); carve-out restricted to accepted role old→new pairs
    plus an over-skip negative test.
24. **V1** — guard switched to import/call-based per module (the literal
    nested-call grep misses schema-export's intermediate-variable
    composition); leftover "exported API" acceptance line fixed.
25. **C1** — reworded to two plan **artifacts** proved/applied as built
    (`provePlan`/`apply` take finished plans; no downstream compact setting).
26. **Changesets** — terminology corrected across all briefs to bump types
    (`patch|minor|none`), not commit types.
27. **D0/K1** — corrected an over-claim introduced in pass 3: the root
    package **does** transitively load sql-format (`index.ts:70-72` →
    `export-sql-files.ts:22`); only focused subpaths avoid it.
28. **Ops** — `engine.test.ts` single-owner rule replaces "coordinate";
    every active brief now opens with a one-line **Contract** so delegates
    get the pinned decisions without reading this log.

Fifth pass (2026-07-21), editorial residue from pass 4 + one design forcing:

29. **P2** — owned-files table rewritten for the P2a/P2b split (P2a touches
    `policy/policy.ts`, `policy/view.ts`, the V1 helper, rule types/data,
    `plan/plan.ts` + artifact type); classification **defaults pinned** per
    stage, including the baseline decision: acknowledged-but-always-visible
    (baseline-suppressed differing subjects get their own summary count;
    strict escalates) — flat-acknowledged would contradict "baseline bugs
    cannot hide," flat-suspicious would red-light every image upgrade.
30. **I1** — normalizer must also remap `FactBase.referenceOnly` (a
    `ReadonlySet` of encoded ids, `core/fact.ts:73`); I1a changeset corrected
    to **none** (ships dark).
31. **Leftover sweeps** — V1: no policy-barrel re-export (`./policy` is a
    public subpath); C1: stale "optional default flips" acceptance line
    removed; P1: `summarizeActions` public escape hatch removed (budgets read
    the plan artifact directly, `prove.ts` untouched); P3: taxonomy tightened
    to SQLSTATE **class 23** (the `DEFAULT VALUES` seeder cannot hit
    generated/identity `428C9` — don't allowlist the unreachable); C2:
    "already C1" default-flip leftover fixed; H1: residual "allowlist" wording
    replaced with baseline-count language; conflict matrix + delegation now
    match the `engine.test.ts` single-owner rule.
32. **Rejected** — reviewer claim that `tests/cli.test.ts` doesn't exist:
    false, the file exists (59.7K). First fully wrong checkable claim across
    five review rounds; everything else was verified before adoption.
    (Reviewer later confirmed the correction: truncated search output.)

Sixth pass (2026-07-21) — final editorial round; **review closed, delegate**:

33. **P1** — replacement predicate pinned to exact `encodeId(...)` equality
    (name-path matching would misclassify routine overloads); stale
    "serialize with P2 on `prove.ts`" clauses removed everywhere — P1 never
    touches `prove.ts` (matrix updated to match).
34. **OVERVIEW** — ship-order diagram now orders P1 after C1 (matching the
    single-owner rule); C1's "Today" row corrected: the compact artifact IS
    proven today — the uncovered risk is compaction masking a broken
    **uncompacted** plan and `--no-compact` users applying a never-proven
    shape.

## Conventions for every agent

- Repo: `packages/pg-delta` under pg-toolbelt. Follow `AGENTS.md` (TDD for
  fix/feat, changeset for behavior changes, focused tests only while iterating).
- Do **not** expand scope into another track's owned files.
- End with: summary of what changed, tests run, residual risks, and whether a
  follow-up track is unblocked.
