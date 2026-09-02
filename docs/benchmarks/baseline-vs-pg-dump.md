# Baseline benchmark: pg-delta vs `pg_dump --schema-only`

**Question.** The platform's branch initialisation (`init_migration` worker
task) replaced the branching service's `pg_dump --schema-only` + restore with a
pg-delta diff-and-apply of the empty branch against its base project, and
branch creation latency went past 3 minutes on large projects. Is that the tool
or how the platform drives it?

**Harness.** `packages/pg-delta/scripts/benchmark-baseline.ts` (see its header
for flags). Same generated source database, a fresh empty target per iteration,
two pipelines interleaved per iteration, each variant on its own target:

- `pg_dump --schema-only` → file → `psql -v ON_ERROR_STOP=1 -f`
- pg-delta: pools → `resolveProfile(target)` → `Promise.all(extract target,
  extract source)` → `plan({ renames: "off", compact: true })` → `apply`, mirroring
  `worker/src/lib/pg-delta.ts::applyBaseline` (Supabase profile, statement
  timeout 30 s), once per extraction-concurrency value. `c1 p1` is the platform
  worker's exact shape (pool `max: 1`, `concurrency: 1`).

After each applied iteration both targets are re-extracted and diffed against
the source (outside the timed window); `residual deltas` is that count.

## Setup

- Sandbox: 4 vCPU, Postgres `postgres:16-alpine` in Docker on loopback, host
  `pg_dump`/`psql` 16.13.
- Runtime: **Node 22.22** (`--experimental-transform-types`) for the headline
  numbers — the platform worker runs on Node. Bun numbers are separate below.
- Fixture `--scale medium`: 10 schemas × 100 tables × 12 columns. Per table:
  identity PK, unique + check constraints, 2–3 indexes, an FK on every third
  table, RLS with two policies, an updated_at trigger, grants to two roles,
  comments; per schema an enum, two functions, a view per five tables.
  Catalog: 8 943 `pg_class` rows, 52 568 `pg_attribute`, 45 394 `pg_depend`.
  pg-delta sees **42 957 source facts** and plans **14 370 actions** (0
  destructive, 1 transactional segment).

## Results (medium fixture, Node, 1 warmup + 2 measured, medians)

| pipeline            | total   | breakdown                                                                  | residual deltas |
| ------------------- | ------- | -------------------------------------------------------------------------- | --------------- |
| `pg_dump` + `psql`  | 16.67 s | dump 1.44 s (3.1 MB) · restore 15.23 s                                     | 0               |
| pg-delta `c1 p1`    | 25.67 s | extract 2.62 s (target 0.14 s ∥ source 2.62 s) · plan 6.07 s · apply gate 0.30 s · apply 16.66 s | 0 |
| pg-delta `c4 p4`    | 24.81 s | extract 1.39 s · plan 6.40 s · apply gate 0.39 s · apply 16.60 s           | 0               |

- Iteration-to-iteration spread was under 1 s for every pipeline.
- `applyStatementMs` (sum of the per-statement round trips `apply()` itself
  measures) equals `applyExecute` within 100 ms: the executor adds no
  overhead between statements; apply time is 14 370 sequential DDL round trips
  at ~1.16 ms each on loopback, in one transaction.
- The `psql` restore of the equivalent dump is the same order of work
  (15.2 s): one statement per round trip, autocommit.

**Reading.** On loopback pg-delta is ~1.5× the dump-and-restore, and the
whole gap is the **plan** phase (6 s of CPU over 43 k facts). Extraction is
cheap here and concurrency 4 halves it. Neither pipeline is anywhere near
minutes: for 1 000 tables the tool costs ~26 s end to end.

## What that says about the platform's 3 min+

Locally the pg-delta pipeline is bounded by (a) plan CPU and (b) one round
trip per action. Both are fixed by the fact/action count, so what turns 26 s
into minutes on the platform has to be per-round-trip latency and per-query
latency, which the loopback benchmark hides:

1. **Serial apply over a real network.** 14 370 statements × RTT. At 2 ms RTT
   that is +29 s, at 10 ms +144 s — on top of the server time. `apply()` sends
   one statement per round trip by design (it needs per-statement failure
   attribution); a dump restore has the same shape but psql runs *on* the
   platform too, so it paid the same RTT before. Measure the worker → project
   RTT first; it is the multiplier on everything below.
2. **Serial extraction with `POOL_CONCURRENCY = 1`.** `worker/src/lib/pg-delta.ts`
   pins both pools to `max: 1`, so `concurrency: 1` is forced (pg-delta clamps
   to the pool size). Extraction is ~20 sequential catalog round trips plus
   the heavy queries; on a high-latency link the docs for `--extract-concurrency`
   in `scripts/benchmark-remote.ts` describe exactly this cost. Raising the pool
   to 4–5 and passing `concurrency: 4` is a one-line change and is what the CLI
   already does (`src/cli/pool.ts`, `max: 5`).
3. **Plan CPU on the worker.** ~6 s per 43 k facts on this 4-vCPU box; scales
   with fact count, so a base project several times this size costs tens of
   seconds of CPU in a job worker before the first statement is sent.
4. **The fingerprint gate re-extracts the branch** (`applyGate`, 0.3 s here):
   cheap because the branch is empty; irrelevant unless the branch is large.

Recommended next step on the platform: log per-phase durations from
`applyBaseline` (extract branch / extract base / plan / apply) alongside the
existing `actions` count, then compare with the table above. If apply dominates
it is RTT × actions and the fix is on the transport side (run the job closer to
the project, or batch); if extraction dominates it is `POOL_CONCURRENCY`; if
plan dominates it is the engine and worth a profile.

Use the remote mode of this harness against a staging pair to get the same
breakdown without touching the worker:

```sh
PGDELTA_BENCH_SOURCE_URL=postgres://…/postgres \
PGDELTA_BENCH_TARGET_ADMIN_URL=postgres://…/postgres \
  node --experimental-transform-types scripts/benchmark-baseline.ts \
    --concurrency 1,4 --iterations 2
```

## Risks noticed along the way

- **One transaction for the whole baseline.** The 14 370-action plan applied
  as a single transactional segment. Every relation created in it holds a lock
  until COMMIT, so the lock table (`max_locks_per_transaction ×
  (max_connections + max_prepared_transactions)`) bounds how large a base
  project can be baselined in one go. A side experiment on the same cluster
  hit `out of shared memory … increase max_locks_per_transaction` at ~2 000
  tables (with their sequences and PK indexes) under the default 64 slots with
  `max_connections=300`; a small compute with `max_connections=60` has a lock
  table a fifth that size. `pg_dump` restores are autocommit and never hit
  this. Worth checking against the largest base projects before relying on
  pg-delta baselines for them.
- **Fidelity.** On this fixture both pipelines left zero residual deltas. The
  extension-state fidelity argument for pg-delta (pg_cron/pgmq/pg_partman
  intent) is not exercised by a stock-image fixture; run the harness against a
  Supabase image (`--image supabase/postgres:…`) to see it.

## Bun vs Node (why the headline numbers are Node)

The same 500-table run (7 185 actions) under both runtimes, same container:

| runtime                      | extract source | plan   | apply    |
| ---------------------------- | -------------- | ------ | -------- |
| Node 22                      | 1.27 s         | 2.45 s | 8.51 s   |
| Bun 1.3.11 (`BUN_OPTIONS=`)  | 1.28 s         | 2.13 s | 52.60 s  |

A Bun CPU profile of the apply phase put a third of all samples in the native
socket `writeBuffered` under the pg driver's send path, and the process sat at
100 % CPU while Postgres was idle-in-transaction 90 % of the time. A plain
`pg` loop issuing the same DDL is *not* slow under Bun (2 000 statements in
~9 s on either runtime, 1 s of client CPU), and neither is a scratch script
that extracts, plans and applies with nothing else on the heap (17 s). What
makes it slow is live heap: applying with one extra retained fact base took
41.6 s, and a second apply in the same process with that heap still alive took
108.6 s. Bun's (JSC) GC cost per round trip scales with the live heap, and a
fact base is a large object graph. Node/V8 does not show this.

Consequences:

- Platform numbers must be taken under Node (which is what the worker runs).
- The pg-delta test loop runs under Bun (`bun test`) and every proof/corpus
  case does an apply with several fact bases alive, so the corpus is paying
  this tax. Follow-up recorded in `docs/roadmap/pg-delta-next-follow-ups.md`.
