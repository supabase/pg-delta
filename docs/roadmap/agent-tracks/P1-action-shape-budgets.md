# P1 — Action-shape budgets in corpus

**Priority:** High (proof quality) · **Wave:** 3 · **Ship:** alone · **Depends on:** V1 preferred · **Serialize with:** C1/P3 on `tests/engine.test.ts` (single owner — land after C1 or stack on its branch); no P2 conflict (P1 never touches `prove.ts`)

> **Contract:** opt-in per-scenario, **per-direction** semantic budgets,
> evaluated against the **uncompacted** plan artifact, speaking the derived
> vocabulary (replacement/rename predicates over `create|alter|drop` actions) —
> never raw counts as primary.

## Goal

Make the corpus catch **convergent but catastrophic** plans (e.g. DROP+CREATE
where in-place ALTER is required) via **action-shape budgets** / semantic
assertions — not only hash convergence.

## Why this track exists

Proof answers “does the managed view converge?” Drop+create almost always proves
green. Reviews called this out: proof is a backstop, not a synthesis oracle.
Without budgets, maintainers optimize for green proofs over idiomatic DDL.

## Out of scope

- Unfiltered drift mode (P2)
- Changing autoSeed defaults (P3) — coordinate if you share `engine.test.ts`
- Compaction defaults (C1)
- Rewriting the rule table for every noisy scenario — only pin high-risk kinds

## Owned files (write)

| Area | Paths |
|---|---|
| Budget helper | Test-only helper under `tests/` (preferred — keeps the shipped `proof/` surface clean) **or** `src/proof/budgets.ts` if a real library use case exists |
| Harness | `packages/pg-delta/tests/engine.test.ts` (minimal hook) |
| Fixtures | Opt-in per-scenario files under `packages/pg-delta/corpus/<scenario>/` e.g. `budget.json` or `expect.yaml` |
| Unit tests | `src/proof/budgets.test.ts` |

**Do not touch `proof/prove.ts` at all** — the budget helper reads the plan
artifact’s action list directly (it is already accessible); no exported hook,
no `summarizeActions` on the public surface. P2 owns prove API changes.

## Design requirements

1. Budgets are **opt-in per scenario** (don’t break 300+ scenarios on day one),
   and **per direction**: the corpus proves a→b and b→a, whose plan shapes
   legitimately differ. The fixture format must let a budget target one
   direction or both explicitly (e.g. `{"a-to-b": …, "b-to-a": …}`); a
   direction-blind budget will false-positive on the reverse run.
2. Start with a small allowlist of high-risk scenarios (replace-vs-alter for
   tables/columns, views/policies rebuild storms, extension drops).
3. Budget dimensions — **lead with semantic assertions** (stable, express intent):
   - forbid `drop`/`create` of kind K when alter is expected
   - forbid *replacement* of kind K when `alter` expected (see vocabulary below)
   - **Avoid** raw `max actions total` as a primary budget — it rots into
     snapshot-churn on every unrelated planner improvement. Use counts only as
     a last resort for a known pathological storm, with a comment explaining why.

   **Action vocabulary (pinned — the raw plan cannot express these directly).**
   `Action.verb` is only `"create" | "alter" | "drop"` (`plan.ts:36-60`) —
   there is **no `replace` verb**, no subject field (actions carry
   `produces`/`destroys` StableId sets), and renames emit as `alter`. The
   budget helper must therefore define derived predicates over the action
   list: **replacement(K)** = a `drop` and a `create` whose `destroys`/
   `produces` contain the **same StableId by exact `encodeId(...)` equality**
   — identity fields beyond names (routine signatures, ACL columns) are part
   of the id, and name-path matching would misclassify a dropped overload +
   added overload as a replacement;
   **rename(K)** = an `alter` whose `produces` and `destroys` are both
   non-empty subtrees. Document the derivation in the helper — budget fixtures
   speak this derived vocabulary, never raw verbs.

   **Budgets evaluate the uncompacted plan form, pinned.** Compaction folds
   revoke/grant pairs and elides actions, which distorts shape assertions;
   with C1's dual-prove both artifacts exist, so assert against
   `compact: false` output.
4. Failure message must show **actual vs budget** and scenario name.
5. Document fixture schema in `corpus/README` or `tests/README` if one exists;
   otherwise a short section in this track’s PR description + comment on helper.
6. Cross-link known-bad shapes to live issues when possible:
   [#332](https://github.com/supabase/pg-toolbelt/issues/332),
   [#333](https://github.com/supabase/pg-toolbelt/issues/333) — prefer pinning
   real backlog bugs over purely synthetic fixtures.

## RED → GREEN

1. Pick one known noisy-but-wrong-shape scenario (or craft a tiny corpus case)
   that today converges with too many DROP+CREATE.
2. **RED:** Add `budget.json` that fails on current plan shape.
3. **GREEN:** Only if the track includes a planner fix — **this track’s default
   is harness-only**. If the first scenario fails for a real planner bug, either:
   - land harness + known-failing budget as `test.skip` / expected-fail list, or
   - split: P1 lands harness + budgets for scenarios that already pass; file
     follow-up issues for failing ones.
4. Prefer: land 3–5 budgets that **pass on current main**, proving the harness,
   plus one skipped RED documenting a known bad shape.

## Acceptance criteria

- [x] Fixture format + loader documented
- [x] Engine harness enforces budgets when present
- [x] ≥3 live scenarios with passing budgets
- [x] ≥1 documented known-bad shape (skip or issue link) if no planner fix in-PR
- [x] Changeset: none if tests-only; `minor` if public prove helpers exported

## Conflicts

- **C1/P3:** `engine.test.ts` single owner — land after C1 or stack on its
  branch.
- **P2:** no conflict — P1 never touches `prove.ts`; P2 owns the prove API.
- **I1:** avoid rename corpus churn while I1 open; pick non-rename scenarios.

## Done when

Corpus can express “this migration must look like X,” unblocking later planner
tightening without expanding prove’s convergence contract.
