# P2 — Attributed projection audit

**Priority:** Medium–High · **Wave:** 3 · **Ship:** **two PRs** — P2a
(attribution plumbing in `policy/`, the heavy half) then P2b (prove/CLI
surfacing, thin) · **Depends on:** V1 (attribution flows through the sealed
helper) · **Serialize with:** P1 on `prove.ts`; P3's `autoSeedEmptyTables`
touch

> **Contract:** attribution over **suppressed deltas/state** (not dropped
> facts), with stable reason codes, descendant attribution, the full stage
> enum (incl. `managedBy`, reference-only), acknowledged/suspicious defaults
> per stage — computed at **plan time**, attached to the plan artifact. P2a =
> plumbing in `policy/`, P2b = prove/CLI surfacing.

## Goal

Report, alongside the managed proof, an **attributed projection audit**: every
fact the projection excluded from the managed view, tagged with **which stage
and rule excluded it** and whether it **still differs** between source and
desired — classified **acknowledged** (expected for this profile) vs
**suspicious** (user-namespace object eaten by a generic rule). So
policy/baseline/scope bugs cannot hide behind a green managed proof.

## Why this track exists

Prove reconstructs the projected desired view (`resolveView` / scope / baseline /
capability). Wrong view wiring fails as drift — or greens a plan that never
managed what the user thought. The failure mode this track exists for:

> Policy (or scope) accidentally dropped a **user** object from the managed view
> while it still differs in the catalog.

## Out of scope

- Action budgets (P1)
- autoSeed default flip (P3)
- Identity normalization (I1)
- Changing what `resolveView` filters — only **observability** of both layers

## Owned files (write)

| PR | Area | Paths |
|---|---|---|
| **P2a** | Attribution plumbing | `policy/policy.ts` (`resolveView`), `policy/view.ts` (`projectManagementScope`), the V1 reconstruction helper (attribution threads through it) |
| **P2a** | Reason codes / flags | Policy rule types + rule data (per-rule classification overrides) |
| **P2a** | Plan artifact | `plan/plan.ts` + the plan artifact/result type (audit attached at plan time) |
| **P2a** | Tests | Projection/policy unit tests; plan artifact tests; public-API surface tests |
| **P2b** | Prove result | `proof/prove.ts`, `proof/prove.test.ts` — surface the plan-attached audit |
| **P2b** | CLI | `cli/commands/prove.ts`, `cli/commands/drift.ts` — additive fields only; focused cases in `tests/cli.test.ts` |
| **P2b** | Docs | Short note in README prove section or `managed-view-architecture.md` |

## Audit model (pinned — challenge in PR if wrong)

Two earlier designs were rejected for the same reason — **an unattributed
second drift diff is perpetually noisy**:

- *Raw-extract drift*: platform/extension noise always red-lights.
- *Baseline-subtracted drift* (and its “projection residue” refinement):
  intentionally excluded objects that legitimately differ (e.g. Supabase
  platform schemas excluded by policy scope rules, cluster objects under
  database scope) are also “excluded from the view and still different.”
  Operators learn to ignore the signal, which defeats it.

The signal must carry **attribution**:

**The unit of attribution is the suppressed delta/state, not the dropped
fact.** Projection does more than drop facts: it keeps facts as
**reference-only** while suppressing their payload and edge deltas
(`core/diff.ts:32`), it prunes **edges** independently of their endpoint
facts, and it hard-projects **`managedBy` provenance** unconditionally
(`policy/policy.ts:850`). An audit that only tracks “excluded facts” is blind
to all three.

| Piece | Definition |
|---|---|
| **Managed drift** | Today’s prove compare, after `reconstructManagedView` — unchanged. |
| **Suppression record** | For each delta/state the projection suppressed relative to the pre-projection catalog: `{ subject (factId or edge), stage, reasonCode, viaDescendantOf? }`. Stage enum (complete): baseline · policy scope rule · capability · management scope · reference-only projection · **managedBy provenance**. Reason codes are **stable identifiers** (data, not prose) so tooling can allowlist them. Facts pruned as descendants of an excluded root carry `viaDescendantOf: rootId` — attribution points at the decision, not the collateral. |
| **Audit entry** | Suppression record joined with “does this subject differ between source and desired?” — only differing suppressed subjects are reported. |
| **Classification** | **acknowledged** vs **suspicious**, per the pinned defaults table below; per-rule flags override. The rubric is data, not a hardcoded schema list. |

**Pinned classification defaults (challenge in PR if wrong, don't improvise):**

| Stage | Default | Rationale |
|---|---|---|
| `managedBy` provenance | acknowledged | explicit ownership marker |
| Reference-only projection (extension members, assumed schemas) | acknowledged | structural, named mechanism |
| Capability restriction | acknowledged | server capability is a fact, not a choice |
| Management scope | acknowledged | explicit user/profile choice (`scope: database` etc.) |
| Policy scope rule | per-rule flag; **default suspicious for generic/wildcard matchers, acknowledged for named-object rules** | a wildcard eating a user object is exactly the bug class |
| Baseline | **acknowledged but always visible** — baseline-suppressed *differing* subjects are reported as their own count in the audit summary, never silently folded; strict mode escalates them | the goal says baseline bugs cannot hide: a baseline that captured user state must be detectable, but flat-suspicious would red-light every image upgrade |

**Where the audit runs: plan time, pinned.** `provePlan` takes a finished
`Plan` and has no raw pre-projection source FactBase (`prove.ts:379-384`), so
the audit is computed during planning — where both raw fact bases are in
hand — and attached to the plan artifact; prove/CLI only surface it. Do not
add a pre-apply extraction to prove for this.

This requires `resolveView` / `projectManagementScope` (via V1’s helper) to
**emit suppression attribution** — an additive optional output, off the hot
path when not requested. That is **P2a**, the core engineering of this track
(it touches the projection path V1 just sealed — attribution must flow through
the helper, not around it). **P2b** is the prove-result/CLI surfacing on top.

## Design requirements

1. **Additive API:** existing `ok` / managed proof semantics unchanged unless
   documented as intentional. The audit is informational by default.
2. Code comments restate the audit model above at the attribution site.
3. CLI: human-readable section + machine-readable field; don’t fail CI corpus
   on audit findings unless opted in (`strictAudit` or similar — and then only
   on **suspicious** entries, never acknowledged ones).
4. Unit tests: managed green / audit red (synthetic fact bases where a generic
   policy rule filters out a differing user fact → one **suspicious** entry
   with the correct stage + rule attribution).

## RED → GREEN

1. **RED:** A policy rule filters a user fact out of the managed view while it
   still differs — managed proof ignores it; the audit must surface it as
   **suspicious** with stage/rule attribution. Companion case: a
   platform-schema fact excluded by a named rule differs → **acknowledged**,
   not suspicious.
2. **GREEN:** Attribution plumbing + audit join; wire CLI optionally.
3. Focused:
   ```bash
   cd packages/pg-delta
   bun test src/proof/prove.test.ts
   bun test tests/cli.test.ts  # if CLI surfaced
   ```

## Acceptance criteria

- [ ] Prove result includes the projection-audit summary (even if empty)
- [ ] Every audit entry carries stage + rule attribution and a
      suspicious/acknowledged classification
- [ ] Audit model matches the table above (or PR documents a justified amendment)
- [ ] Managed path uses sealed reconstruct helper (V1); attribution flows
      through it, not around it
- [ ] Tests cover suspicious vs acknowledged vs clean, including a
      reference-only payload-suppression case and a descendant-attribution case
- [ ] Audit computed at plan time and attached to the plan artifact; prove/CLI
      only surface it
- [ ] Changeset: `minor` (new plan-artifact/prove-result surface)
- [ ] No corpus mass-failure (opt-in strictness, suspicious-only)

## Conflicts

- Sole owner of `prove.ts` while this track is open
- Do not parallel with V1 or heavy I1 prove rename edits

## Done when

Operators can see “managed ok, but the projection excluded N differing facts —
M suspicious (rule X ate schema Y), rest acknowledged.”
