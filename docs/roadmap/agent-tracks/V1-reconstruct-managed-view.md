# V1 — Seal `reconstructManagedView`

**Priority:** Highest · **Wave:** 1 · **Ship:** one PR, one agent · **Blocks:** I1; prefer before P2/C1

> **Contract:** one **internal** helper seals `resolveView` →
> `projectManagementScope` for the four full call sites; pin is byte-identical
> output vs today (not raw-FB identity); guard is import/call-based per module.

## Goal

Replace the duplicated `resolveView` → `projectManagementScope` composition with
**one helper** used by plan, prove, apply, export (and any other reconstruction
path). Order bugs already happened once; convention + comments are not enough.

## Why this track exists

Today the load-bearing order is documented in
`plan/phases/change-set.ts` (~lines 101–138):

```ts
projectManagementScope(resolveView(fb, policy, capability, baseline), scope, scopeOpts)
```

The same **full** composition (`resolveView` then `projectManagementScope`) is
open-coded in exactly four sites today:

- `plan/phases/change-set.ts`
- `proof/prove.ts`
- `apply/apply.ts`
- `frontends/schema-export.ts`

`ResolvedProfile` shares *options*, but not a single reconstruction function.

**Not full managed-view sites:** `cli/commands/diff.ts` and
`frontends/seed-assumed-schemas.ts` call `resolveView` **without**
`projectManagementScope`. Do **not** force them through scope projection.
Either leave them on `resolveView` only, or give the helper an explicit
`scope: "none" | omit` / `projectScope: false` mode that is resolveView-only —
do not change their semantics by accident.

## Out of scope

- Do **not** implement pre-diff rename identity (I1).
- Do **not** change compaction defaults (C1).
- Do **not** add proof budgets or autoSeed (P*).
- Do **not** redesign policy/Supabase rules.

## Owned files (write)

| Area | Paths |
|---|---|
| New helper | `packages/pg-delta/src/policy/view.ts` **or** new `policy/reconstruct.ts`. Do **not** re-export from the policy barrel — `./policy` is a public subpath (`package.json` exports), and this helper is internal-only |
| Call sites (required) | `plan/phases/change-set.ts`, `proof/prove.ts`, `apply/apply.ts`, `frontends/schema-export.ts` |
| Optional / resolveView-only | `cli/commands/diff.ts`, `frontends/seed-assumed-schemas.ts` — see note above; do not add scope projection |
| Profile (only if needed) | `integrations/profile.ts` — wire helper into documented “how to rebuild the view” without changing profile semantics |
| Tests | `policy/view.test.ts` / new `policy/reconstruct.test.ts`; update call-site tests if snapshots of structure change; add a **guard** that greps call sites |

## Read-only references

- `docs/architecture/managed-view-architecture.md`
- `integrations/profile.ts` header comment (`plan == prove == apply` by option identity)
- `policy/policy.ts` — `resolveView`
- `policy/view.ts` — `projectManagementScope`
- Owner-exclusion vs database-scope comments in `change-set.ts`

## Design requirements

1. **Single function**, something like:
   ```ts
   reconstructManagedView(
     fb: FactBase,
     opts: {
       policy?: Policy;
       capability?: …;
       baseline?: …;
       scope?: ManagementScope; // default "cluster"
       defaultOwner?: string;
     },
   ): FactBase
   ```
   **Keep it internal.** Do not export from the package index (`src/index.ts`)
   — the invariant is internal, and `ResolvedProfile` remains the public
   safe-composition surface. Export later only if a concrete embedder use case
   appears.
2. **Order is fixed inside the helper:** `resolveView` then `projectManagementScope`.
   Document why (owner edges needed before role prune under database scope).
3. **Behavior pin = byte-identical output vs today at every call site** — not
   “identity on the raw fact base.” `resolveView` with no policy/baseline/
   capability is true identity **only** when the fact base has no extension
   members and no `managedBy` provenance: `extensionMemberReferenceOnly` and
   `excludeByProvenance(base, "managedBy")` run unconditionally
   (`policy/policy.ts:838-850`; early return at `:887`). Do not write a test
   asserting raw-FB identity in the general case — it is false.
4. Call sites pass the same knobs they pass today — behavior-preserving refactor.
5. Add a unit/guard test — **guard on imports/calls per module, not a literal
   nested-call grep**. `schema-export.ts` composes via an intermediate variable
   (`resolveView` at ~:78, `projectManagementScope` at ~:122), so grepping for
   `projectManagementScope(resolveView(` passes today while the duplication
   stands. Instead: fail if any module outside the helper imports (or calls)
   **both** `resolveView` and `projectManagementScope`. Bare `resolveView`
   alone may remain in diff/seed paths.

## RED → GREEN

1. **RED:** Add the guard test expecting a single reconstruction entry point
   (will fail while duplication exists), **or** a behavioral test that documents
   current order (owner-exclusion + database scope) and will be the regression
   pin after the move.
2. **GREEN:** Introduce helper, migrate call sites, make guard pass.
3. Run focused tests:
   ```bash
   cd packages/pg-delta
   bun test src/policy/
   bun test src/plan/phases/ src/proof/prove.test.ts
   bun test tests/schema-frontends.test.ts  # if export path touched
   ```
4. If behavior could drift: one PG17 corpus shard is enough only if you changed
   semantics; for pure move, unit/integration above is enough.

## Acceptance criteria

- [ ] One **internal** reconstruction helper (not on the package index); all
      four plan/prove/apply/export call sites use it
- [ ] Guard prevents reintroduction of open-coded `resolveView`+scope composition
- [ ] No intentional behavior change; existing view/scope tests still pass
- [ ] Short note in `managed-view-architecture.md` pointing at the helper
- [ ] Changeset: none (internal refactor, no behavior change, no public
      surface change); `patch` only if any public export does move

## Conflicts / do not touch

- `plan/role-rename-carry.ts`, `plan/internal.ts` compaction passes
- Rule tables, extractors
- Corpus SQL fixtures

## Done when

V1 merged → unblocks I1 (identity normalize against one view) and makes P2/C1
safer to land without re-breaking view order.
