# P3 — autoSeed on by default in CI corpus

**Priority:** Medium · **Wave:** 3 · **Ship:** alone (tiny) · **Parallel with:** P1 (if P1 avoids prove defaults), D0, V1 · **Depends on:** nothing (V1 not required)

> **Contract:** first make seeding observable (per-table outcome, SQLSTATE
> taxonomy, no empty catch), then enable autoSeed at the harness level with a
> keyed skip-allowlist and strict-on-unknown; library default unchanged.

## Goal

Turn on **data-proof seeding** (`autoSeed`) for the corpus / CI path so empty
tables don’t silently get `contentMode: "none"` and green-wash data safety.

## Why this track exists

`prove.ts` already supports coverage modes and opt-in `autoSeed`. Reviews noted
empty tables → weak data proof. Productizing honesty means CI exercises the
stronger path.

## Out of scope

- Budgets (P1), unfiltered drift (P2)
- Changing fingerprint algorithms
- Seeding strategy redesign beyond enabling existing autoSeed

## Owned files (write)

| Area | Paths |
|---|---|
| Corpus harness | `packages/pg-delta/tests/engine.test.ts` |
| CI | `.github/workflows/tests.yml` only if an env flag is required |
| Seeder observability | `proof/prove.ts` — **only** the `autoSeedEmptyTables` function and the seed-outcome plumbing into the result type (requirement 4); serialize with P2, which owns the rest of `prove.ts` |
| Prove defaults (careful) | Prefer harness-level `autoSeed: true` over changing global library default |
| Docs | One line in `packages/pg-delta/README.md` prove section or corpus docs |

## Design requirements

1. Prefer **test/CI opt-in** over changing library default for all `provePlan`
   callers (avoid surprising embedders).
2. If some scenarios cannot seed (extensions, exotic types), allowlist skips with
   reason — don’t weaken the global default for everyone.
3. Failures must be actionable (which scenario, which table, coverage mode).
4. **Fix seeder observability first — flipping the flag alone proves nothing.**
   `autoSeedEmptyTables` currently swallows insert failures with an empty catch
   (`proof/prove.ts:257-263`), so `contentMode: "none"` conflates “genuinely
   unseedable” with “failed for an unexpected reason nobody saw.” Required:
   record a per-table seed outcome — `seeded | skipped(reason) | failed(error)`
   — and surface it in the prove result. Then enforce a **coverage contract**
   in the corpus: a table ending at `"none"` must carry an allowlisted reason;
   an unexpected failure class fails the scenario (or reports loudly under a
   non-strict default — pick one and document it).
5. **Pinned taxonomy — do not improvise.** `skipped` vs `failed` is decided by
   **SQLSTATE class**, not string matching. The seeder inserts
   `DEFAULT VALUES` (`prove.ts:259`), so the reachable expected-unseedable
   errors are exactly **class 23 (integrity constraint violations)** — `23502`
   not-null without default, `23503` FK, `23505` unique, `23514` check →
   `skipped(reason=SQLSTATE)`. (Generated/identity `428C9` errors are
   unreachable via `DEFAULT VALUES` — do not allowlist what cannot occur.)
   **One documented exception to "SQLSTATE only":** a `DEFAULT VALUES` insert
   can *resolve* yet leave no row in the final pre-apply snapshot — a BEFORE
   INSERT trigger returning NULL, a DO INSTEAD rule, or an AFTER INSERT trigger
   deleting the row (possibly while seeding a later table). rowCount is the
   command tag, not persisted state, so persistence is judged by reconciling
   provisional seeds against that one snapshot, not a per-insert probe. That is
   also `skipped`, with the **synthetic sentinel `reason=no_row`** — the one
   non-SQLSTATE skip code. Everything else
   (connection, syntax, permission, raised exceptions, unknown states) →
   `failed(error)`; only class-23 and `no_row` are skips. The skip-allowlist is
   keyed by `{ scenario, direction, table, reasonCode }` — no bare table names.
   Strict behavior: any `failed` outcome, or a `skipped` with a non-allowlisted
   key, fails the scenario.

## RED → GREEN

1. Enable autoSeed on corpus; run:
   ```bash
   cd packages/pg-delta
   PGDELTA_TEST_IMAGE=postgres:17-alpine bun test tests/engine.test.ts
   ```
2. Fix or skip scenarios that fail for environmental reasons; do not disable
   autoSeed globally to silence them.

## Acceptance criteria

- [ ] Corpus CI path runs with autoSeed enabled
- [ ] Per-table seed outcome (`seeded | skipped(reason) | failed(error)`)
      recorded and surfaced; no empty-catch swallowing remains
- [ ] Coverage contract enforced: `contentMode: "none"` only with an
      allowlisted reason; unexpected failure classes are loud
- [ ] Library default for ad-hoc `provePlan` unchanged (or documented if changed)
- [ ] Skip list (if any) documented, keyed per the pinned taxonomy
- [ ] Changeset: `patch` (seed-outcome reporting in the prove result); the
      harness/CI part needs none

## Conflicts

- Light touch on `engine.test.ts` — coordinate with P1 if both land the same week
- `prove.ts`: only the seeding function + outcome plumbing; everything else is
  P2’s turf — serialize with P2 rather than sharing the file

## Done when

CI data proof is meaningfully stronger than fingerprint-on-empty-tables.
