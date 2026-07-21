# I1 — Pre-diff rename identity normalization

**Priority:** Highest strategic · **Wave:** 2 · **Ship:** **two PRs** — I1a (pure normalizer, no pipeline change) then I1b (pipeline integration + carry deletion) · **Depends on:** V1 merged; **B1 merged** (cycle fix + scenario become I1's pin); C1 dual-prove preferred first (corpus gate then covers both compact modes) · **Conflicts with:** B1, C1, H1, anyone on carry/emitter

> **Contract:** role renames only, normalized pre-diff into **desired**-name
> space (ids + edges + payload role refs). Pipeline: discovery diff → filter →
> propose from kept → normalize → canonical diff → filter → plan. Only
> `source.fingerprint` uses the physical (un-rewritten) view; rename emission
> stays in the existing action-emitter seam; carry (and B1's carve-out) deleted;
> I1b adds the corpus `renames` opt-in.

## Goal

Treat accepted renames (especially **role renames**) as a **rewriting of both
fact bases into a canonical StableId space**, then run ordinary diff/plan with
**zero cancel/carry folklore**. Shrink or delete `role-rename-carry` as a
planner feature.

## Why this track exists

Stable ids embed role **names** (`acl.grantee`, `membership`, `userMapping`,
`defaultPrivilege`, owner edges). Postgres carries refs by OID, so
`ALTER ROLE … RENAME` produces remove/add churn that
`plan/role-rename-carry.ts` (225 LOC) cancels after the fact. Column ACL was
already a regression in that seam (`relabel` dropping fields). Carry will keep
growing with every new role-bearing field.

Target end state:

> Structural matching **proposes** renames; identity normalization **applies**
> them to both sides; diff sees continuity; carry modules become a bug.

## Out of scope

- Compaction policy (C1/C2)
- Action budgets (P1)
- sql-format / frontends packaging (K1)
- Changing which renames are *accepted* (keep `plan/renames.ts` matching policy
  unless required for correctness)

## Owned files (write)

| Area | Paths |
|---|---|
| New normalizer | Prefer `plan/identity-normalize.ts` (or `core/` if pure + reusable) |
| Rename emission | **Existing seam** in `plan/phases/action-emitter.ts` (~lines 180–194) — keep it; see **Design decisions §2** |
| Integration point | After managed view reconstruction, **before** `diff()` — `plan/phases/change-set.ts` |
| Shrink/remove | `plan/role-rename-carry.ts`, call sites in `change-set.ts` / `plan/phases/action-emitter.ts` |
| Proof | **No changes expected** — `prove.ts` `renamedTables` is table/matview rename machinery (role renames are filtered out, ~prove.ts:411–414); out of scope, P2 owns `prove.ts` |
| Tests | normalize unit tests; `tests/role-rename-column-grant-carry.test.ts`; `tests/renames.test.ts`; corpus rename scenarios |

## Read-only references

- `plan/role-rename-carry.ts` (current Depth Module — inventory of kinds)
- `core/stable-id.ts` — codec, column-qualified ACL ids
- `plan/renames.ts` — accepted rename proposal
- `docs/architecture/target-architecture.md`
- V1 helper: call `reconstructManagedView` then normalize — do not open-code view
- Live backlog cross-refs: [#332](https://github.com/supabase/pg-toolbelt/issues/332),
  [#333](https://github.com/supabase/pg-toolbelt/issues/333) — pin rename scenarios
  that match real fidelity gaps when available

## Design decisions (do not rediscover mid-PR)

These are load-bearing. Challenge them in the PR description if wrong; do not
leave them implicit.

### 1. Canonical direction = **desired (new) names**

Rewrite **both** fact bases so every role-name-bearing StableId uses the
**post-rename** name (the desired / `to` side of each accepted role rename).

Rationale: rename actions must sort **before** dependent DDL so subsequent
statements render against post-rename names. Canonicalizing to old names would
force the rest of the plan to speak pre-rename identifiers.

### 2. Rename emission already exists — keep the seam, do not rebuild it

Rename actions are **already synthesized outside generic diff**: the action
emitter iterates `acceptedRenames` and invokes each kind’s `rename` rule
(`plan/phases/action-emitter.ts` ~lines 180–194), emitting the action with
`produces` = new subtree / `destroys` = old subtree. Diff never emits renames
today, and `role-rename-carry.ts` only cancels churn — it never emits the
rename itself. **Do not build a second emission path.**

What normalization changes *around* that existing seam:

- **Capture `acceptedRenames` before the id rewrite.** The rename rule renders
  from the original `from` fact (`ALTER ROLE old RENAME TO new`); the emitter
  must keep receiving pre-rewrite from-facts, not normalized ones.
- **Ordering pin:** post-normalization, dependent facts reference **new**-name
  ids, so the existing `produces` = new-subtree edge is what sorts the rename
  before its dependents. Add a regression test for that ordering — today it
  also leans on old ids existing on the source side.

```text
discovery diff(source, desired)                    # EXISTING: proposals need its
  → filterDeltas(allDeltas, policy, …)             # EXISTING: policy keeps/filters
  → propose + accept renames from KEPT deltas      # remove/add maps are built from
    (original from-facts captured)                 # filtered deltas — change-set.ts:141-162
  → record physical source fingerprint (§6) BEFORE any rewrite
  → rewrite both FBs to desired names (ids + edges + payload role refs, §3)
  → canonical diff(source′, desired′)              # sees continuity; no churn
  → filterDeltas AGAIN on canonical deltas         # filtering is delta-level
  → action emitter synthesizes rename actions from acceptedRenames (existing code)
  → emit remaining actions (no carry canceler)
```

**Two diffs, by design.** `matchRenameCandidates` consumes the remove/add maps
of an initial diff — and today those maps are built from the **policy-kept**
deltas (`filterDeltas` at `change-set.ts:141-143`, maps at `:152`), not from
`allDeltas`. Preserve that: proposals come from kept deltas on both passes.
Diff is an in-memory Merkle compare; running it twice is cheap. Do not try to
collapse this into one pass, and do **not** reintroduce post-diff remove/add
cancellation to “find” renames.

**What feeds what.** Everything downstream of normalization — canonical deltas,
their filtering, replacement expansion, emission, the dependency graph, and the
**desired-side** fingerprint (canonical desired names *are* the physical
post-apply names) — consumes the canonical pair. **Only `source.fingerprint`
uses `physicalSource`** (§6).

**Scope: role renames only.** Normalization rewrites role-name-bearing ids,
edges, and payload role refs. Non-role object renames (tables, views, …) keep
today’s mechanism unchanged: matched remove/add pairs leave the worklists and
the rename rule emits the action — that existing subtree cancellation is not
carry folklore and is not this track’s target.

### 3. What the rewrite must touch

Symmetric rewrite on source and desired for every kind in
`ROLE_NAME_BEARING_KINDS`, plus:

- **Dependency / owner edges** whose endpoints embed role names
- Any hash-adjacent structures derived from those ids (recompute rollups after
  rewrite; do not leave stale Merkle nodes)
- Column-qualified ACL keys (`acl:(…).grantee.column`) — full codec round-trip
- **`FactBase.referenceOnly`** — a `ReadonlySet` of **encoded ids**
  (`core/fact.ts:73`); remap it alongside facts and edges, or reference-only
  tracking silently detaches from the rewritten ids
- **Structured role-bearing payloads** — role names that live in fact
  *payloads*, not ids. Known inventory today: `policy.roles`
  (`extract/policies.ts:39`). This is **in scope**, not residual: unhandled, it
  produced the B1 dependency cycle (policy `consumes`/`releases` vs the rename
  action — see [B1](B1-role-rename-policy-cycle.md)), and “zero carry folklore”
  is false if payload refs still need a special-case carve-out. After
  normalization the policy delta vanishes entirely (correct: `polroles` is
  OID-carried, Postgres renames it for free) and B1's carve-out is deleted
  along with carry. Inventory payload role-ref fields explicitly in the PR;
  `policy.roles` is the only known case.

Prefer **copy-on-write** fact bases; do not mutate extract outputs shared with
other commands unless proven safe.

### 4. Owner edges + dual renames

Today’s emitter zip/projection must either fall out of normalization or be
re-proven with an explicit regression test. Dual object+role renames are in
scope for that pin.

### 5. Carry retirement

Default goal: **delete** `role-rename-carry` cancel logic. If a residual remains,
document the exact kinds and why; do not keep the full Depth Module “just in
case.”

### 6. Physical vs canonical source — the fingerprint gate

`plan.source.fingerprint` is recorded from the managed view (`plan.ts:516`) and
`apply()` re-extracts the **physical** target — which still has pre-rename
names — and compares (`apply/apply.ts:158-186`). Today no mismatch exists
because nothing rewrites `source`. Under I1, a naive “normalize, then plan”
would fingerprint post-rename ids and the gate would **always fail** against
the real database.

Therefore keep both:

- **`physicalSource`** — the un-rewritten managed view; sole input for
  `source.fingerprint` and the apply gate.
- **`canonicalSource` / `canonicalDesired`** — the rewritten pair; used only
  for the canonical diff and planning.

Add a regression test: plan with an accepted role rename, assert the recorded
fingerprint equals the physical managed view's root hash (not the canonical
one), and that apply's gate passes against a pre-rename extraction.

## Two-PR split

- **I1a — pure normalizer.** `plan/identity-normalize.ts` (+ unit tests): given
  a fact base and an accepted-rename map, return the rewritten copy (ids,
  edges, payload role refs, recomputed rollups). No pipeline changes; carry
  untouched; ships dark.
- **I1b — pipeline integration.** Wire the normalizer into `change-set.ts`
  (discovery diff → filter → normalize → canonical diff → filter), record
  physical source fingerprint per §6, delete carry (and B1's carve-out),
  migrate tests, full corpus gate.

  **I1b also owns the corpus rename opt-in.** The corpus currently plans with
  `renames` defaulting to `"off"` (`tests/engine.test.ts:50`), so **no corpus
  scenario exercises rename acceptance at all** — “corpus green” does not pin
  rename behavior. Add scenario-level metadata (e.g. `meta.renames: "auto"`)
  so B1's and I1's rename scenarios run inside the proof loop, and convert
  B1's focused scenario into a corpus case.

## Design requirements (checklist)

1. Pipeline order as in decision §2.
2. Guard against new role-name-bearing kinds moves with the normalizer (same
   spirit as today’s `ROLE_NAME_BEARING_KINDS` ↔ `ALL_FACT_KINDS` partition test).
3. Column-qualified ACL + role rename integration test stays green **without**
   hand-maintained field spreads in a carry relabeler.

## RED → GREEN

**Mandate this RED (behavior, not implementation absence):**

1. Unit test: after normalization, `diff(source′, desired′)` has **no**
   remove/add (or unlink/link) pairs that are pure role-name relabels for
   ACL / membership / owner / defaultPrivilege / userMapping.
2. Plan-level test: accepted role rename + column ACL → plan contains the
   rename action(s) and does **not** contain REVOKE/GRANT churn for the rename.
3. Do **not** use “assert carry module is unimported” as the primary pin.

**GREEN:** Implement normalizer (rename emission stays in the existing
action-emitter seam — decision §2); remove carry; re-run:

```bash
cd packages/pg-delta
bun test src/plan/identity-*.test.ts src/plan/renames*.test.ts
bun test tests/role-rename-column-grant-carry.test.ts tests/renames.test.ts
PGDELTA_TEST_IMAGE=postgres:17-alpine bun test tests/engine.test.ts  # required
```

## Acceptance criteria

- [ ] Canonical direction = desired names (documented in code)
- [ ] Rename emission stays in the existing action-emitter seam, fed
      pre-rewrite from-facts; not recovered via carry; ordering pinned by test
- [ ] Role-name relabel churn absent from post-normalize diff
- [ ] Column ACL + role rename regression green
- [ ] Corpus green on at least PG 17 full run, **including** rename scenarios
      running under the new `meta.renames` opt-in (I1b)
- [ ] B1's carve-out removed or proven dead (I1b — folklore must not survive
      under a new name)
- [ ] Changeset: I1a **none** (ships dark — internal module, no behavior
      change); I1b `minor` if the plan result surface changes, else `patch`
- [ ] Tombstone/doc for the new seam (and deleted carry)

## Conflicts / do not touch

- `plan/internal.ts` compaction (C1)
- Policy/Supabase rule bodies
- Extract SQL except if a bug blocks normalization (escalate; don’t expand)

## Done when

Carry is gone or trivially thin (including B1's carve-out); I2 can document the
invariant. C1's dual-prove is expected to be in place already (see scheduling) —
I1's corpus gate then covers both compact modes.
