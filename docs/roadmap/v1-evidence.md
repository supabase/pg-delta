# pg-delta-next — v1 evidence record

- **Purpose**: the recorded, reproducible proof that the v1 correctness gates
  passed *at scale* — not just at CI defaults. v1 is not cut until this document
  is filled and the gates are green. Parent roadmap:
  [`v1.md`](v1.md) (§2,
  "Validation — run the gates to green at scale").
- **Status**: ⏳ **TEMPLATE — not yet run.** The engineering correctness items
  are shipped (roadmap §1); this is the remaining validation-at-scale gate.

> Fill every field below from a single run on one commit. If a field cannot be
> filled, say why explicitly — a blank or "N/A" with no reason is itself a v1
> blocker. Silent omission is the exact failure mode v1 is designed to prevent.

## Run identity

| Field | Value |
|---|---|
| Commit SHA | `<git rev-parse HEAD>` |
| Branch | `feat/pg-delta-next` |
| Date (UTC) | `<YYYY-MM-DD>` |
| PG versions exercised | `15`, `17`, `18` |
| Runner / environment | `<CI matrix or local + machine>` |
| `EXPECTED_RED` contents | `<must be empty, or each entry justified>` |

## Gate 1 — corpus proof loop

Every scenario × 2 directions under the full proof loop (state +
data-preservation + rewrite observation), on each PG version.

```bash
cd packages/pg-delta-next
PGDELTA_TEST_IMAGE=postgres:15-alpine bun test tests/engine.test.ts
PGDELTA_TEST_IMAGE=postgres:17-alpine bun test tests/engine.test.ts
PGDELTA_TEST_IMAGE=postgres:18-alpine bun test tests/engine.test.ts
```

| PG | Scenarios | Pass | Fail | Notes |
|---|---|---|---|---|
| 15 | `<n>` | | | |
| 17 | `<n>` | | | |
| 18 | `<n>` | | | |

## Gate 2 — differential (new engine vs old `pg-delta`), full run

```bash
PGDELTA_NEXT_DIFFERENTIAL=all PGDELTA_TEST_IMAGE=postgres:17-alpine \
  bun test tests/differential.test.ts
```

Bucket counts (the hard gate is **zero untriaged `new-fails-old-converges`**):

| Bucket | Count | Notes |
|---|---|---|
| both-converge | | |
| accepted-difference | | each needs a one-line reason below |
| new-fails-old-converges | | **must be 0 untriaged** |
| old-fails-new-converges | | (new strictly better) |

Accepted differences (reason each):

- `<id>` — `<why this difference is acceptable>`

## Gate 3 — generative soak

Agreed quota: **`<set the soak quota for the v1 run>`**.

```bash
PGDELTA_NEXT_SOAK=<quota> PGDELTA_TEST_IMAGE=postgres:17-alpine \
  bun test tests/generative.test.ts
```

| Field | Value |
|---|---|
| Seed range | `<from>`–`<to>` |
| Iterations | `<n>` |
| Proof failures / cycles / crashes | `<must be 0>` |
| Kind-coverage checklist satisfied | `<yes/no — list any kind not exercised>` |

## Gate 4 — real-world shakedown

At least one large, anonymized, production-shaped schema through `plan` + `prove`.

| Field | Value |
|---|---|
| Schema description (anonymized) | `<object counts by kind, size>` |
| Source | `<where it came from, anonymized>` |
| plan result | `<actions, filtered, safety report>` |
| prove result | `<pass/fail; if fail, the drift>` |
| `unmodeled_kind` diagnostics | `<list, or "none">` |

## Gate 5 — Supabase baseline path

`src/policy/baselines/` holds only `.gitkeep` today; `supabasePolicy` does NOT
declare a baseline yet (a declared-but-unresolved baseline now fail-fasts —
`resolveBaseline`). v1 either (a) commits a real Supabase baseline snapshot and
exercises subtraction in CI, or (b) explicitly excludes baseline subtraction
from v1 scope (filters alone hide platform objects).

| Field | Value |
|---|---|
| Decision | **defer to post-v1** (option b) |
| If committed: file(s) | n/a |
| If committed: zero-residue check | n/a |
| If deferred: rationale | The supabase policy's filter rules are the v1 correctness mechanism — every known platform object class is hidden by an explicit rule (system schemas/roles/extensions, FDW ACLs, system-role ADPs, the platform role plumbing incl. `supabase_privileged_role` and the `postgres` role object, #371). The baseline is an *increment* over the filters (long-tail platform state, user-vs-platform disambiguation), not a replacement: subtraction only removes present-and-identical facts, so version/image drift degrades gracefully back to the filters anyway. Against that marginal v1 value stand real prerequisites — per-PG-major committed snapshots regenerated on every image bump (declared-but-unresolved fail-fasts, so partial major coverage bricks the profile), prove-side wiring (`provePlan` must resolve the baseline or baseline-shaped plans drift at prove time), and the Phase 2b seed-derivation revisit. Tracked in [post-v1.md](post-v1.md#-supabase-baseline-snapshot). |

> **When committing the baseline, also wire the prove side.** `plan()` subtracts
> the baseline (via `options.baseline`); the proof loop re-derives the view from
> `plan.policy` (`resolveView(policy, capability)`) **without** a baseline, so a
> baseline-shaped plan would drift at prove time. Resolve the baseline in
> `provePlan` too (`resolveBaseline(plan.policy, { pgMajor })` → `resolveView`'s
> baseline arg) and add a corpus/integration case that a baseline plan proves
> clean. This is untestable until a fixture exists, which is why it lives here.

## Deliberate exclusions still in effect at v1

(From `COVERAGE.md` + the `unmodeled_kind` completeness diagnostic — these are
the things v1 *says it does not manage*, now enforced and visible.)

- Unmodeled kinds (detected + reported, not modeled): cast, operator,
  operator class/family, text-search config/dict/parser/template, statistics
  object, user language, transform.
- 4b deferred extractor families: sub-entity families (columns, constraints,
  indexes, triggers, policies, rewrite rules) and rare member-root kinds (FDW,
  server, foreign table, event trigger, publication) still filtered at extract.
- `<anything else surfaced during the run>`

## Sign-off

- [ ] All gates green on the recorded commit.
- [ ] `EXPECTED_RED` empty (or every entry justified).
- [ ] Every accepted-difference and deliberate exclusion has a reason.
- [ ] v1 scope statement published (links here).
