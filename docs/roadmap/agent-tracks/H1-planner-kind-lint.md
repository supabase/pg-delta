# H1 — Planner-body kind-switch lint

**Priority:** Low–Medium · **Wave:** 5 · **Ship:** alone · **Depends on:** C1 (prefer after C2) · **Conflicts with:** I1, C1, C2 while those edit `internal.ts`

> **Contract:** per-file kind-check **count ratchet** (baseline table, fails
> on growth, shrinks by baseline update); `plan/rules/**` exempt by design.

## Goal

Add a guard test (like `diff.guard.test.ts`) that fails when new per-kind
switches appear in planner **body** modules outside the rule table / approved
allowlist — so Guardrail 3 doesn’t rot into folklore.

## Why this track exists

Generic diff is kind-free; `plan/` still has many kind checks (~127 historically).
`internal.ts` knows schema/acl/owner/role. Without a lint, the next PG feature
lands as another late pass.

## Out of scope

- Large behavioral refactors (do those in C2/H2 first)
- Touching `core/diff.ts` guard (already exists)

## Owned files (write)

- New: `packages/pg-delta/src/plan/plan.guard.test.ts` (name flexible)
- A **per-file baseline count table** (see design requirements) — `plan/rules/**`
  exempt by design (the rule table is where kind knowledge belongs)
- Optional: tiny cleanups **only** if needed to make the baseline lint pass

## Design requirements

1. Mirror the spirit of `diff.guard.test.ts` (grep for kind string literals or
   `kind ===` in disallowed paths).
2. **Per-file count ratchet, not a file allowlist.** `plan/` has ~79 existing
   kind-checks; a file-level allowlist that blesses `internal.ts` wholesale is
   toothless (new switches in an allowlisted file pass silently). Instead:
   record today’s count per file as the baseline; the guard fails if any
   file’s count **exceeds** its baseline; shrinking is allowed and should be
   committed as a baseline update in the same PR that removes the checks.
3. `plan/rules/**` is exempt (kind knowledge belongs in the rule table);
   everything else in `plan/` gets a baseline entry.
4. PR description lists the baseline table and which tracks are expected to
   shrink which entries.

## RED → GREEN

1. Write guard in failing mode against a known bad pattern, then record the
   per-file baseline counts so CI is green.
2. Optionally add one intentional violation in a test fixture file to prove the
   guard catches regressions.

## Acceptance criteria

- [ ] Guard runs in `bun test src/`
- [ ] Per-file baseline count table documented
- [ ] No unrelated refactors
- [ ] Changeset: none (tests only)

## Done when

New kind switches in `plan/plan.ts` / `internal.ts` fail CI unless explicitly
allowlisted.
