# pg-delta-next dogfooding findings

Compare **pg-delta** (old) vs **pg-delta-next** (new) on bookmark, dbdev-migrations fixture, and corpus scenarios.

## Tooling

```bash
cd packages/pg-delta-next

bun run compare --source "$SRC" --desired "$DES" --scenario my-scenario --out-dir /tmp/compare --profile supabase
bun run compare --fixture dbdev --migrations core|all --scenario dbdev-fixture-core-roundtrip --out-dir /tmp/compare --profile supabase
bun run compare --corpus table-ops--comments --scenario corpus-comments --out-dir /tmp/compare --apply-check
bun run dogfood --out-dir docs/dogfooding/runs/suite --dbdev-scope core
bun run dogfood:bookmark docs/dogfooding/runs/bookmark
bun run dogfood:report --run-dir ../../docs/dogfooding/runs/suite --open
```

Compaction is on by default (cosmetic, proof-stable). Add `--no-compact` to `compare` to emit maximally-inlined DDL (one statement per action, every `REVOKE`/`GRANT` spelled out) — useful for statement-by-statement engine diffing.

Artifacts per scenario: `old.sql`, `new.sql`, `new-plan.json`, `sql.diff`, `metrics.json`, optional `new-plan-error.txt`, `prove.json`, `apply-check.json`.

## Run metadata

| Field | Value |
|-------|-------|
| Date | 2026-06-23 (re-run, `--prove` enabled) |
| Bookmark bootstrap | Supabase testcontainer (`supabase/postgres:15.14.1.107`) |
| dbdev fixture | `packages/pg-delta/tests/integration/fixtures/dbdev-migrations/` (core scope, 12 migrations) |
| Corpus image | `postgres:17-alpine` |
| Run outputs | `docs/dogfooding/runs/suite/`, `docs/dogfooding/runs/bookmark/` |
| Container hygiene | `bun run docker:clean --all` after — 0 leaked (suite's shared-cluster singleton + its Ryuk lingered until `--all`, by design) |
| Proof | `provePlan` ran on every scenario: **all `ok=true`, 0 drift deltas**. dbdev core: 48/48 tables checked in ~2.5 s. |

---

## Summary

### Scenarios run

| Scenario | Old stmts | New stmts | New plan ms | Apply bucket | Notes |
|----------|-----------|-----------|-------------|--------------|-------|
| bookmark-zero-diff | 0 | 0 | 32 | n/a | Both agree: no diff |
| bookmark-add-column | 1 | 1 | 26 | both-converge | Apply-check now wired (Item A) |
| bookmark-rls-change | 1 | 1 | 28 | both-converge | Apply-check now wired (Item A) |
| table-ops--comments | 6 | 6 | 4 | both-converge | Statement counts match |
| table-ops--empty-table | 2 | 4 | 1.6 | both-converge | Default ACL elided; owner `ALTER`s remain (Item D) |
| function-ops--simple-create | 2 | 2 | 2.7 | both-converge | Default ACL elided (Item D) |
| type-ops--enum-create | 1 | 2 | 1.1 | both-converge | Default ACL elided — `CREATE TYPE` + `OWNER` only (Item D) |
| view-operations--simple-create | 1 | 2 | 0.6 | both-converge | Default ACL elided (Item D) |
| **dbdev-fixture-core-roundtrip** | 142 | 227 | 57 | **old-fingerprint-gate** | Converges; old engine trips its own fingerprint gate (Item B); new stmts 343→227 after ACL elision |
| dbdev-fixture-zero-diff | 0 | 0 | 35 | both-converge | Expected |

The improvements below were implemented on this branch (Items A–D). Earlier numbers (enum 6, empty-table 8, dbdev 343, bucket `old-fails-new-converges`) are pre-fix.

### What changed since the 2026-06-18 run

1. **dbdev declarative roundtrip is unblocked.** The previous run failed new-engine planning with `consumes role:anon … neither exists nor is produced by this plan` on `ALTER DEFAULT PRIVILEGES … TO anon`. That gap is gone: the core fixture now plans 343 actions and **converges** under apply-check (`newConverges: true`). The old engine refuses the clone-apply with `fingerprint_mismatch` (its own apply-time safety gate), hence `old-fails-new-converges`.
2. **Plan speed lead widened.** New engine plans the full dbdev core fixture in **44 ms vs 1011 ms** old (~23×); zero-diff in **41 ms vs 1428 ms** (~35×). Corpus picks plan in sub-5 ms.
3. **Decomposition divergence on object creation.** Old and new no longer match statement *counts* on create-heavy scenarios. New explicitly materializes ownership and the full default ACL; old folds it into `AUTHORIZATION` / omits defaults. All still `both-converge`.

### Top DX wins (new engine)

- **Plan speed**: 20–35× faster on the dbdev fixture; sub-5 ms on corpus picks.
- **Safety metadata**: `safetyReport` aggregates lock classes & risk. dbdev core: 0 destructive, 13 rewrite-risk, 67 `accessExclusive` / 11 `shareRowExclusive` / 2 `share` / 263 `none`.
- **Structured output**: `new-plan.json` is CI-friendly; SQL extracted to `new.sql`.
- **Convergence proof**: apply-check re-extracts through the profile lens and confirms 0 residual actions.

### Top readability / correctness-of-output concerns

- **Default-ACL & ownership churn (biggest issue).** On every create scenario the new engine emits the implicit default privileges as explicit DDL. Examples:
  - enum: `CREATE TYPE` is followed by `REVOKE ALL … FROM PUBLIC` + `GRANT USAGE … TO PUBLIC` (the PG default) **and** `REVOKE ALL … FROM "test"` + `GRANT USAGE … TO "test"` (owner already has this). 1 statement → 6.
  - schema/table: `ALTER … OWNER TO` plus a REVOKE-then-GRANT pair to the owner that restates PG defaults. Old engine uses `CREATE SCHEMA … AUTHORIZATION test` and omits owner grants entirely.
  These are **correct** (both converge) but bloat migration files 4–8× with no-op privilege restatements.
- **Statement ordering** still differs old vs new on equal-count scenarios — compare `sql.diff`, not just counts.

### Recommendations (status)

1. ✅ **Suppress default-ACL emission (Item D, done).** A cosmetic compaction pass (`elideDefaultAclCreates`, `src/plan/internal.ts`) elides the REVOKE/GRANT pair on a co-created object when the grant reproduces a PG default (owner's implicit grant; PUBLIC `USAGE`/`EXECUTE` on types/domains/languages/functions/procedures/aggregates). Proof-stable (asserted on/off in `tests/compaction.test.ts`); enum 6→2, dbdev 343→227. Gated on the full corpus (432/432, PG15 + PG17). Owner `ALTER … OWNER TO` is intentionally kept (folding into `CREATE SCHEMA AUTHORIZATION` is a separate, deferred nicety).
2. ✅ **Bookmark dogfood apply-check (Item A, done).** `BookmarkFixture` now exposes a `baselineCloneSource`; `run-bookmark-dogfood.ts` passes it so add-column/rls-change run a real apply-check (`both-converge`). The clone uses a one-shot `template1` client to avoid the `CREATE DATABASE … TEMPLATE postgres` "other users" race.
3. ✅ **dbdev roundtrip (Item C, verified).** `tests/dbdev-roundtrip.test.ts` already existed and converges (core scope, PG15) — no port needed.
4. ✅ **`old-fingerprint-gate` bucket (Item B, done).** `decideConvergenceBucket` (`scripts/lib/compare-core.ts`) now tags the old engine's clone-apply `fingerprint_mismatch` distinctly from genuine divergence; unit-tested in `compare-core.test.ts`.
5. ✅ **`--no-compact` documented (Item C, done).** README + this doc note compaction is on by default and how to disable it.

Remaining / deferred: fold ownership into `CREATE SCHEMA … AUTHORIZATION` (would take empty-table 4→2); statement-ordering differences vs old on equal-count scenarios (cosmetic, compare `sql.diff`).

---

## Per-scenario notes

### dbdev-fixture-core-roundtrip (was blocked, now converges)

- **Before (2026-06-18):** new-engine plan threw on `ALTER DEFAULT PRIVILEGES … TO anon` (filtered Supabase role not in managed view).
- **Now:** 343 actions, `newConverges: true`. Old engine clone-apply returns `fingerprint_mismatch` → bucket `old-fails-new-converges`.
- **Verdict:** Major fix. The filtered-role planning gap is closed. Follow up by porting the dedicated roundtrip test.

### type-ops--enum-create (readability regression vs old)

- **Old SQL:** `CREATE TYPE test_schema.mood AS ENUM (...)` — 1 statement.
- **New SQL:** 6 statements — `CREATE TYPE`, `ALTER TYPE … OWNER TO`, then two REVOKE/GRANT pairs (PUBLIC USAGE and owner USAGE) that restate PG defaults.
- **Verdict:** Correct but noisy; primary motivation for recommendation #1.

### table-ops--empty-table

- **Old:** `CREATE SCHEMA … AUTHORIZATION test` + `CREATE TABLE …` (2 statements).
- **New:** 8 statements — separate `OWNER TO` for schema and table plus REVOKE/GRANT-to-owner pairs for both.
- **Verdict:** Same default-ACL churn pattern at table+schema scope.

### bookmark-add-column / bookmark-rls-change

- **New SQL:** clean single statements (`ADD COLUMN "tags" text[]`; `CREATE POLICY …`). Excellent.
- **Caveat:** apply-check not actually run (harness gap, recommendation #2).

## SQL readability scores (qualitative)

| Scenario | Stmt count (new) | Readability | Migration-file fit |
|----------|------------------|-------------|-------------------|
| bookmark-add-column | 1 | Excellent | Yes |
| bookmark-rls-change | 1 | Excellent | Yes |
| table-ops--comments | 6 | Good | Yes (mind ordering) |
| type-ops--enum-create | 6 | Noisy (default-ACL churn) | Needs recommendation #1 |
| table-ops--empty-table | 8 | Noisy (default-ACL churn) | Needs recommendation #1 |
| dbdev core roundtrip | 343 | Converges; verbose | Acceptable for full bootstrap |
