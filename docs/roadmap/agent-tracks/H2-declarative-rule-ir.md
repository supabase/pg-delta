# H2 — Declarative replace/rebuild IR (**evidence-gated — not scheduled**)

**Priority:** None until gated · **Wave:** — · **Ship:** not scheduled · **Status:** park indefinitely pending evidence

## Status

**Do not delegate this track** unless the evidence gate below is met.

TS callbacks on a rule table (`replaceWhen`, `rebuildsDependents`) already *are*
the declarative boundary relative to 106 change classes. Encoding those
predicates as “data” means inventing an expression language for
`replacement-expansion` to interpret — trading type-checked TypeScript for a
homegrown DSL that is harder to debug and unlikely to be smaller.
`rules/helpers.ts` is **~830 LOC**; that alone is not a bug.

Wave-5 / Priority-Low in the original plan was an admission of this. Made
explicit: **aesthetics dressed as architecture until evidence appears.**

## Evidence gate (revisit only if)

Open this track only when **at least one** is true:

1. A shipped bug is traced to callback sprawl / inconsistent `replaceWhen`
   duplication across kinds (cite issue + failing test), **or**
2. A concrete kind family cannot be expressed with typed callbacks without
   copy-paste that has already caused a divergence, **or**
3. Maintainers agree in writing that a minimal typed IR (not a string DSL) would
   unlock a specific user-visible fix.

Until then: prefer fixing the bug in `plan/rules/<kind>.ts` + expander tests.

## Goal (if unparked)

Reduce *demonstrably harmful* imperative replace/rebuild knowledge by moving
**one** kind family into data consumed by `replacement-expansion`, with a typed
IR — not an open-ended expression language.

## Out of scope (even if unparked)

- Compaction (C1/C2)
- Identity (I1)
- “Migrate all kinds” rewrites
- Inventing a general-purpose rule DSL

## Owned files (write) — only after gate

| Area | Paths |
|---|---|
| Rule IR | `plan/rules.ts`, selected `plan/rules/*.ts` |
| Expander | `plan/phases/replacement-expansion.ts` |
| Helpers | `plan/rules/helpers.ts` only when deleting dead paths |
| Evidence | Link issue + RED test in PR body |

## Method (if unparked)

1. Cite the evidence gate item.
2. Migrate **one** kind family end-to-end.
3. Stop. No drive-by “while we’re here” IR expansion.

## Acceptance criteria (if unparked)

- [ ] Evidence cited (issue + test)
- [ ] One kind family data-driven; unrelated kinds untouched
- [ ] No new stringly DSL
- [ ] Changeset `refactor` or `fix`

## Done when

Not applicable while parked. When unparked: a pattern exists for the next family
*and* the motivating bug is fixed.
