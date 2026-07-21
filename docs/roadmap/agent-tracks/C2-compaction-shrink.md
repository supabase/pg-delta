# C2 — Shrink load-bearing compaction elisions

**Priority:** Medium–Low · **Wave:** 4 (after C1) · **Ship:** alone · **Depends on:** C1 (dual-prove safety net) · **Conflicts with:** H1 (same `internal.ts`)

> **Contract:** evidence-gated (a dual-prove divergence or an implicated bug).
> Per-fact suppressions may become rules; cross-action folding stays
> pretty-only — it cannot be a per-kind rule.

## Goal

With C1's dual-prove enforcing that compaction is never *required* for
convergence (C1 does **not** flip any default), **delete or move** elisions
that encode ADP/default-ACL/create-as-applier semantics into the rule table
(or leave them only on the pretty path with explicit tests).

## Why this track exists

Even as a pretty-printer, `internal.ts` kind-switches (policy drops, PUBLIC
defaults, ACL revoke/grant folding). Reviews: anything needing “is this
load-bearing?” should consult payload+edges in one helper or not elide.

## Out of scope

- Default compact flip (not happening anywhere — C1 is harness-only; any flip
  is a separate product decision)
- Full declarative rule IR (H2)
- Identity (I1)

## Owned files (write)

- `packages/pg-delta/src/plan/internal.ts` (+ `internal.test.ts`)
- Possibly `plan/rules/metadata.ts` if an elision becomes a rule suppress
- Docs: comment pass list in README compact section

## Evidence gate

Prefer opening this track only when C1's dual-prove has surfaced a concrete
compact/uncompact divergence, or a specific elision is implicated in a bug.
A purely aesthetic LOC-reduction pass on `internal.ts` is not worth the risk.

## Method

1. Inventory compaction passes (README already lists ~5).
2. Classify each on **two axes**: (a) pure cosmetic vs encodes PG
   default/create model; (b) **per-fact suppression vs cross-action folding**.
3. Only **per-fact** suppressions are candidates to move into `KindRules` —
   cross-action folding (revoke/grant pairs, cascade subsumption) is
   plan-global by nature and **cannot** be expressed as a per-kind rule; those
   passes stay pretty-only with a named export + unit tests proving
   equivalence on fixtures.
4. Prefer fewer passes over cleverer passes.

## RED → GREEN

Per elision removed/moved: a unit test that pins before/after SQL or action
lists on a minimal fact fixture (TDD).

## Acceptance criteria

- [ ] `internal.ts` LOC trending down (target: meaningful cut, not drive-by)
- [ ] No elision that ignores payload refs the way
      `elideCascadeSubsumedPolicyDrops` historically could
- [ ] Pretty path still useful for common ACL noise
- [ ] Changeset: `patch` if `--compact` output changes; none for pure
      internal moves

## Done when

Compaction is honestly a peephole pretty-printer; H1 lint can ban new kind
switches in `internal.ts` without a huge allowlist.
