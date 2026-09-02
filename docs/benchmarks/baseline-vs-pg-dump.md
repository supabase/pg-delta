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

## Topology reproduction: cross-region RTT and round trips

The platform runs `init_migration` on the PRIMARY worker in `ap-southeast-1`
against project databases in the customer's region, and Sentry shows a p50 of
210 ms per db span on that task — essentially one RTT per statement. To
reproduce that on a loopback container the harness now routes every connection
through a per-side latency proxy (`scripts/lib/latency-proxy.ts`) that adds a
configurable RTT and counts protocol round trips (`ReadyForQuery` messages),
and it runs the shapes under discussion side by side:

| pipeline           | shape                                                                              |
| ------------------ | ---------------------------------------------------------------------------------- |
| `pg_dump+psql`     | `pg_dump --schema-only` → `psql -f` (one round trip per statement)                  |
| `pg_dump+batch`    | same dump sent as ONE multi-statement query (the legacy branching service's pgx-batch shape) |
| `pg-delta worker`  | pool 1, concurrency 1, fingerprint gate on — the `init_migration` task as deployed |
| `pg-delta tuned`   | pool 5, concurrency 4, gate off — the proposed platform-side change                |
| `pg-delta batched` | `tuned` + apply as ONE multi-statement query per transactional segment — prototype of the proposed executor change |

Fixture: 2 schemas × 50 tables (100 tables, 4 315 facts, **1 446 actions** —
the size band of the failing Sentry jobs, 1 084–1 764 actions). Node 22,
`postgres:16-alpine`, one iteration per cell (RTT-bound results are
deterministic: total ≈ round trips × RTT + the 0 ms cost).

| pipeline           | rt target | rt source | 0 ms   | 20 ms  | 100 ms  | 200 ms  | residual deltas |
| ------------------ | --------- | --------- | ------ | ------ | ------- | ------- | --------------- |
| `pg_dump+psql`     | 1 683     | 193       | 2.0 s  | 42.5 s | 193.6 s | 381.8 s | 0               |
| `pg_dump+batch`    | 2         | 193       | 1.0 s  | 5.4 s  | 21.5 s  | 41.1 s  | 0               |
| `pg-delta worker`  | 1 504     | 26        | 2.6 s  | 34.8 s | 156.2 s | 307.7 s | 0               |
| `pg-delta tuned`   | 1 487     | 35        | 2.2 s  | 33.2 s | 152.1 s | 300.1 s | 0               |
| `pg-delta batched` | 37        | 35        | 1.6 s  | 2.1 s  | 3.9 s   | 6.6 s   | 0               |

Round trips per phase, `pg-delta worker`: connect 4, profile 1, extract target
26, extract source 26, fingerprint gate 26, apply **1 451** (1 446 actions +
BEGIN, two `SET LOCAL`, COMMIT, one preamble round trip). `tuned` moves each
extraction to 35 round trips spread over 4 streams (so wall time drops even
though the count rises) and removes the gate's 26; apply is unchanged.
`batched` collapses apply to 1.

What this reproduces:

- **The Sentry numbers.** At 200 ms the worker shape takes 307.7 s (5.1 min)
  for 1 446 actions: 1 504 round trips × 0.2 s. The p50 of 5.5 min and the
  6.5 min estimated for a 1 764-action plan fall out of the same line. Apply
  is 294.6 s of the 307.7 s; the three serial extractions (78 round trips)
  are the 16 s "before the first DDL" seen in the longest sampled trace.
- **Why the legacy path did not pay this.** The dump itself costs 193 round
  trips (39.6 s at 200 ms; pg_dump queries per object), but its pgx-batch
  restore costs 2. `psql -f` would have paid 1 683 round trips and been slower
  than pg-delta: the legacy advantage was the batch, not the dump.
- **Which fix moves what.** `tuned` (pool + concurrency + no gate) saves 7.6 s
  at 200 ms, all in extraction; it does nothing for the 295 s of apply.
  `batched` makes the whole pipeline RTT-insensitive: 6.6 s at 200 ms, of
  which 3.6 s is the remaining extraction round trips. Co-locating the worker
  with the project (RTT ~1 ms) makes every shape land under 3 s for this
  fixture, which is why it is the largest single platform-side win; batching
  the executor is what makes pg-delta safe for any consumer that cannot
  co-locate.
- **Fidelity is unchanged by batching.** Every cell, including the
  multi-statement prototypes, leaves zero residual deltas against the source.

Reproduce a single cell:

```sh
node --experimental-transform-types scripts/benchmark-baseline.ts \
  --schemas 2 --tables 50 --rtt 200 --variants worker,batched \
  --restore batch --iterations 1 --warmups 0
```

## Dropped connections crash the host process

`scripts/repro-dropped-connection.ts` cuts the proxied socket once during
`extract` and once during `apply` (no superuser needed: the proxy destroys
both halves, which is what a path reset or a killed backend looks like to the
client). Under Node 22, both scenarios end the same way: the awaited call
fails as it should — `extract` rejects, `apply` returns `status: "failed"` with
`Connection terminated unexpectedly` — **and** a second copy of that error
reaches `process.on("uncaughtException")`. The script only installs that
handler to report; a worker has none, so each is a process exit and every
other in-flight job on the instance dies with it (Sentry: 25 of 67
`init_migration` events are `level:fatal`, `onuncaughtexception`).

Mechanism: `pg` emits `error` on the client whose socket ended; pg-pool
detaches its idle-error listener while a client is checked out; neither
`extract` nor `apply` attaches one to the client they hold, and the worker's
`pool.on("error")` covers idle clients only. Fix is in pg-delta (attach an
error listener to every checked-out client for the duration of the hold).
Follow-up recorded in `docs/roadmap/pg-delta-next-follow-ups.md`.

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
