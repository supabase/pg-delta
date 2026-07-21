# B1 — Fix role-rename + policy dependency cycle (bug)

**Priority:** Urgent (crash-class planner bug on main) · **Wave:** 1 (parallel with V1) ·
**Ship:** one PR, one agent · **Blocks:** I1 (normalization later subsumes this fix) ·
**Conflicts with:** I1, anyone on `internal.ts` ordering or `rules/policies.ts`

> **Contract:** focused `renames: "auto"` RED first (corpus can't express
> renames); fix = release-edge carve-out restricted to accepted role old→new
> pairs, with an over-skip negative test; I1b deletes the carve-out.

## Bug

An accepted role rename plus an RLS policy whose `roles` payload references the
renamed role **fails to plan**. Reproduced 2026-07-20 on `feat/pg-delta-next`
with an in-memory FactBase (source: role `role_a` + policy `roles: ["role_a"]`;
desired: renamed to `role_b`), `plan({ renames: "auto", compact: false })`:

```text
dependency cycle among 2 actions — this is a rule/emission bug, fix the rule (guardrail 4):
  ALTER ROLE "role_a" RENAME TO "role_b"
  ALTER POLICY "docs_read" ON "app"."t" TO "role_b"
```

## Mechanism (verified)

- `rules/policies.ts` `roles.alter` (~48–72) sets `consumes = [newRole]`,
  `releases = [oldRole]` — plain string-set diff, no rename awareness.
- `internal.ts`: `consumes` → produce-before-consume edge `[rename, policy]`
  (~133–147); `releases` → **unconditional** release-before-destroy edge
  `[policy, rename]` (~126–132). The rename action `produces` the new role
  subtree and `destroys` the old, so both edges target the same action → 2-cycle.
- The existing rename carve-out (`internal.ts` ~191, ~246) covers only
  `owner`-kind edges during subtree traversal — not an action's own
  `consumes`/`releases`.
- `policy` is deliberately absent from `ROLE_NAME_BEARING_KINDS` (role name is
  **payload**-carried, `extract/policies.ts:39`), so carry never sees it.

## Coverage gap

No corpus scenario or integration test combines a role rename with a policy
referencing the renamed role (`rls-operations--policy-roles-swap` is
drop+create, not rename). That is why nothing caught this.

## RED first (TDD, mandatory)

**The corpus cannot express this bug today**: the harness plans with no
`renames` option (`tests/engine.test.ts:50`), which defaults to `"off"`
(`plan.ts:154-155`) — rename acceptance is never active in the proof loop.
Therefore:

1. **Primary RED:** a focused test with `renames: "auto"` — the in-memory unit
   repro (model on `src/plan/role-rename-carry.test.ts`: role + table + policy
   `TO` that role, renamed on the desired side) plus an integration test that
   plans/proves it end-to-end. Confirm the cycle error verbatim.
2. Capture the failure output for the fix commit message.
3. A corpus scenario for this class lands only once corpus scenarios can opt
   into rename acceptance — that work item is owned by I1b (see I1). Do not
   block B1 on it.

## Fix options (pick one, justify in PR)

1. **Preferred:** rename-aware carve-out in `internal.ts` — when a
   releases-target's destroyer is a rename action that also **produces** the
   corresponding renamed id, skip the release-before-destroy edge (mirrors the
   owner-edge carve-out). **Restrict it to accepted role old→new pairs
   specifically** — do not skip release-before-destroy edges generally — and
   add a **negative over-skip test**: a policy releasing a role that is
   genuinely dropped (not renamed) must still be ordered before the drop.
2. Make `rules/policies.ts` `roles.alter` rename-aware (consult accepted
   renames; don't consume/release ids carried by a rename).
3. Extend carry/relabel to payload role refs — **least preferred**: it grows
   the folklore I1 exists to delete.

Option 1 is smallest and local to ordering; I1's payload normalization later
makes the whole policy delta vanish, at which point the carve-out becomes
dead-but-harmless and is removed with carry.

## Acceptance criteria

- [ ] RED repro captured, then green after fix
- [ ] Focused unit + integration tests committed (`renames: "auto"`) so this
      class stays covered; over-skip negative test included
- [ ] Full corpus green on `postgres:17-alpine` (regression safety — the
      corpus itself cannot exercise renames yet)
- [ ] Changeset: `patch`
- [ ] Note added to I1 that normalization subsumes this carve-out

## Done when

Role rename + dependent policy plans and proves; I1 inherits the scenario as a
pin for payload-role normalization.
