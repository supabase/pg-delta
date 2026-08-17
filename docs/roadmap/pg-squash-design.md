# pg-squash — migration-chain compression with proof of equivalence

Status: **design approved, not started**. Supersedes the "Migration squash / repair"
backlog sketch (`docs/roadmap/backlog.md`, CLI-1597/1598) — that item imagined a
pg-delta command; this design makes it a standalone package so pg-delta keeps its
no-parser rule and pg-topo stays an optional peer of pg-delta.

## 1. Goal

Given an ordered chain of N migration files, emit the **same statements,
verbatim, in the same order**, regrouped into the **minimum number of
transactions**, with a machine-checked proof that replaying the squashed output
produces exactly the same database state as replaying the original chain.

### Invariants (v1)

- **Verbatim:** output contains 100% user statements. The squasher may add only
  transaction control (`BEGIN`/`COMMIT`) and provenance comments
  (`-- pg-squash: from 20240101_create_users.sql`). No statement is ever
  rewritten, reordered, or dropped.
- **Order-preserving:** statement execution order is identical to the original
  chain. (Reorder-based packing via pg-topo's dependency graph = future work.)
- **Proven:** every squash result ships with an equivalence proof (see §6). No
  proof, no output.
- **Fail-safe:** every optimization has a fallback that degrades toward the
  original chain, which is known-good. Worst case output = original boundaries.

### Non-goals (v1)

- Semantic DDL minimization (re-deriving minimal DDL via `plan()`) — future
  opt-in mode; it drops DML and violates verbatim.
- Injected scaffolding (`DISCARD ALL`, `RESET`) — future opt-in flag; v1 repairs
  session-state divergence by splitting output files instead (§7).
- Reordering statements.
- Tablespaces, `ALTER SYSTEM`, `CREATE DATABASE`, replication DDL inside
  migrations — refused with a clear diagnostic (they either can't be sandboxed
  per-database or can't be reverted at cluster scope).

## 2. Package

`packages/pg-squash`, published as `@supabase/pg-squash`. Runtime-agnostic
(Bun/Node/Deno) with the same dual-export build as the sibling packages
(`bun` condition → TS source; `import`/`require` → `dist/` from
`tsc rewriteRelativeImportExtensions`). CLI binary (M3): `pgsquash`.

Dependencies:

- `@supabase/pg-topo` (hard dep) — verbatim statement splitting
  (`parseSqlContent`, byte-offset slicing from `src/ingest/parse.ts`).
- `@supabase/pg-delta` (hard dep) — `extract()`, `FactBase.rootHash`,
  data-fingerprint utility (see §10 pg-delta touchpoints).
- `pg` — connections.
- dev: `testcontainers`.

The composition is the point: pg-delta must not depend on a SQL parser, pg-topo
must not depend on a database. pg-squash needs both, so it lives above them.
pg-delta's CLI can later grow a `squash` alias through an optional-peer probe
(same pattern as `canReorder()`).

## 3. Public API

```typescript
import { squash } from "@supabase/pg-squash";

const result = await squash(chain, {
  cluster,               // ClusterHandle: injected admin connection (CREATEDB-capable)
  baselineDatabase,      // template for per-replay DBs (e.g. supabase stage-ready db); default template0-equivalent
  runnerSemantics,       // "per-file-transaction-fresh-session" (default) | "per-file-transaction-shared-session" | "single-session"
  pgVersion,             // barrier table selection; verified against the cluster at runtime
});
// result: { files, manifest, proof, diagnostics }
```

- `chain` comes from the filesystem adapter (`readChain(dir)` — ordered `.sql`
  files) or is passed directly as `{ name, sql }[]` (Supabase CLI integration
  path: no filesystem assumption in the core, mirroring pg-topo's design).
- `ClusterHandle` is **injected** — the library never manages Docker. Docker
  provisioning lives in the CLI (M3) and in tests (testcontainers). This is what
  lets the Supabase CLI hand pg-squash a pre-warmed supabase-image cluster
  (composes with the PGDATA warm-cache direction from pg-delta PR #429).
- `proof` records: rootHash equality, per-table data coverage
  (`fingerprint | count | none`), cluster-ledger diff equality, volatility-mask
  usage, and replay/repair history (how many split repairs, and why).
- `manifest` maps every output statement back to
  `(source file, statement index, byte range)` for review/audit.

## 4. Module map

```text
packages/pg-squash/
  package.json              # mirror pg-topo (dual exports, files, scripts); bin added in M3
  src/
    index.ts
    model/
      statement.ts          # SquashStatement: verbatim text, source file, offsets, classifications
      chain.ts              # MigrationChain: ordered files → statements
      diagnostics.ts        # diagnostic codes (opaque-file, refused-statement, repair-split, …)
    ingest/
      split.ts              # pg-topo parseSqlContent wrapper; TransactionStmt interpretation;
                            # opaque-file fallbacks (savepoints, psql meta-commands, COPY FROM stdin)
      read-chain.ts         # filesystem adapter (discovery + ordering); core never touches fs
    classify/
      barriers.ts           # static non-transactional table, keyed by PG major (14–18)
      cluster-scope.ts      # static prediction of cluster-global effects (roles, memberships, …)
    pack/
      segment.ts            # Segment = txn(statements[]) | barrier(statement) | opaqueFile(file)
      packer.ts             # pure greedy packer: statements + barrier marks → segments
    shadow/
      cluster.ts            # ClusterHandle contract; version probe; CREATEDB checks
      pool.ts               # warm database pool: CREATE DATABASE … TEMPLATE clones, async replenish
      ledger.ts             # cluster-scope snapshot / diff / revert (roles, memberships, role settings)
      checkpoint.ts         # Checkpoint = { templateDb, ledgerSnapshot }; restore = clone + revert
    replay/
      replay.ts             # execute a chain/candidate under a RunnerSemantics; capture failure site
      runner-semantics.ts   # session/transaction wrapping emulation for the reference replay
      repair.ts             # split-on-failure loop (§7); converges to original boundaries
    prove/
      equivalence.ts        # rootHash + table fingerprints + ledger-diff equality
      volatility.ts         # dual original replay → per-table/column volatility mask
    emit/
      emit.ts               # output files, provenance comments, `-- pg-squash: no-transaction` tags
      manifest.ts
    squash.ts               # orchestrator
  tests/
    containers.ts           # shared-cluster singleton (adapted from pg-delta tests/containers.ts)
    squash.test.ts          # corpus loop
    property.test.ts        # random-split harness over pg-delta corpus scenarios
    corpus/<scenario>/
      migrations/NNNN_*.sql
      config.json           # optional: runnerSemantics, PG version constraints, expected diagnostics
```

## 5. Pipeline

**parse → classify → pack → replay-and-repair → prove → emit**

1. **Parse.** Split every file into verbatim statements (pg-topo byte-offset
   slices — never JS string indices, see supabase/pg-toolbelt#369). Explicit
   `BEGIN`/`COMMIT`/`ROLLBACK` in input become grouping metadata and are dropped
   from output (the packer re-derives boundaries; an explicit input transaction
   is an atomicity *floor* — its statements must land in one output
   transaction, which greedy merging trivially satisfies). Files containing
   `SAVEPOINT`/`ROLLBACK TO`, psql meta-commands, or `COPY … FROM stdin` (inline
   data payload) are carried as **opaque units** — replayed and emitted verbatim
   as their own segment, with a diagnostic — never reinterpreted.
2. **Classify.** Static barrier table per PG major (CREATE/REINDEX/DROP INDEX
   CONCURRENTLY, VACUUM, ALTER SYSTEM, CREATE/DROP DATABASE, CREATE TABLESPACE,
   ALTER TYPE … ADD VALUE (<12), …) plus static cluster-scope prediction. Both
   are **fast-path hints only** — the authoritative signals are runtime:
   SQLSTATE `25001` for barriers (same detection pg-delta's loader uses) and the
   cluster-ledger catalog diff for scope (§8). Postgres stays the only
   elaborator.
3. **Pack.** Greedy: merge consecutive statements into one transaction until a
   barrier; barriers run alone outside any transaction; resume after. Under the
   order-preservation invariant this yields the minimum transaction count.
4. **Replay-and-repair.** Execute the candidate on a shadow DB; on failure,
   split and retry from the nearest checkpoint (§7).
5. **Prove.** Dual replay + extract + compare (§6).
6. **Emit.** One output file per segment (`0001_squashed.sql`, …): transaction
   segments wrapped in explicit `BEGIN`/`COMMIT`, barrier segments tagged
   `-- pg-squash: no-transaction`, per-source-file provenance comment blocks.
   One file per transaction maps 1:1 onto per-file runners (Supabase CLI), so
   output drops into existing workflows unchanged.

## 6. Equivalence proof

Replay original chain → shadow A (under the configured runner semantics);
squashed candidate → shadow B. Equivalence =

1. `extract(A).rootHash === extract(B).rootHash` — whole-database Merkle digest
   (schema, objects, db-local grants, …).
2. **Cluster-ledger diff equality** — the roles/memberships/settings delta
   produced by the original replay equals the squashed replay's delta. Cluster
   effects are part of the proof, not just pollution to manage.
3. **Per-table data fingerprints** — `md5(string_agg(row::text ORDER BY 1))` +
   exact counts (the `tableStats` technique from pg-delta `src/proof/prove.ts`),
   modulo the **volatility mask**: replay the original chain **twice** and diff
   those two runs; any per-table/column instability the original exhibits
   against itself (`now()`, `gen_random_uuid()` backfills, serial assignment
   order) is masked when comparing original vs squashed. Fully principled — we
   never mask more than the original's own nondeterminism — at the cost of one
   extra replay. Coverage per table is reported as `fingerprint | count | none`.

Extraction discipline: `extract()` is the expensive per-DB operation (~42 RTTs),
so it runs only on final states — 3 extracts per squash (A, A′ for volatility,
B) — using extract's snapshot-sharing concurrency option.

## 7. Replay-and-repair loop

Merging can break things no static list knows: enum value added in file 3 and
used in file 7 (fails merged into one transaction on every PG version),
`ON COMMIT DROP` temp-table lifetimes, session-state leaks (a bare
`SET search_path` early changing name resolution later once sessions merge).

Repair move: **insert a segment boundary** before the failing statement (or
isolate it as a barrier if the failure is SQLSTATE `25001`), restore from the
nearest checkpoint, retry. Because each output file runs in a fresh session
under per-file runners, a file split is simultaneously a transaction boundary
*and* a session boundary — so it repairs both transactional failures and
session-state divergence without rewriting anything. **Convergence is
guaranteed:** worst case degenerates to the original file boundaries.

Failures found only at proof time (replay succeeded but states differ) repair
the same way: bisect the divergence to a segment using intermediate-checkpoint
hashes, split there, retry. Repair history lands in `proof` + diagnostics.

## 8. Shadow strategy: one cluster, database-granular everything

The cluster boot is the expensive resource (especially `supabase/postgres`,
which needs service-driven staging) — so boot **one long-lived cluster per
squash run** and make everything else database-granular:

- **Per-replay DBs:** `CREATE DATABASE … TEMPLATE <baselineDatabase>` (~100 ms),
  cloning the stage-ready baseline. Warm pool: K pre-created clones replenished
  asynchronously; taking one is O(1) (the "two shadows swapping" idea,
  generalized).
- **Cluster-scope ledger** (what makes co-location *safe*): snapshot
  `pg_authid`/`pg_auth_members`/`pg_db_role_setting` before a replay, diff
  after (authoritative record of the chain's cluster-global effects), revert
  before the next lane (drop created roles, restore memberships/settings).
  Same approach as `loadSqlFiles`'s `databaseScratch` role-leak
  detection/revert, promoted to a first-class engine component. Replays with a
  non-empty ledger diff are serialized; provably db-local chains may
  parallelize lanes.
- **Checkpoints:** every K statements during the reference replay, snapshot
  `{templateDb (CREATE DATABASE … TEMPLATE, needs zero connections on source —
  the TestDb.clone() pattern), ledgerSnapshot}`. Repair retries restore in
  milliseconds instead of replaying from scratch: cost O(segment), not O(chain).
- **Refusals:** statements the ledger cannot sandbox or revert — tablespaces,
  `ALTER SYSTEM`, `CREATE DATABASE`, replication DDL — produce a structured
  refusal diagnostic. Fallback for callers who need them: fresh-cluster-per-
  replay mode (M2+, slow but always correct). The fast path is an optimization
  the engine falls back from, never a correctness assumption.

Expected cost per run: 1 cluster boot + 3 chain replays + 3 extracts + a
handful of segment-sized repair retries → tens of seconds for hundreds of
small migrations.

## 9. Runner semantics (load-bearing)

The reference replay must emulate how the user's runner actually executes the
original chain — session and transaction wrapping both matter (a `SET` in file
1 must not leak into file 2 if the real runner uses fresh sessions).
`RunnerSemantics` modes: `per-file-transaction-fresh-session` (expected Supabase
CLI behavior — **verify and pin as an M0 task**), `per-file-transaction-shared-
session`, `single-session`. The squashed output's semantics are fixed by
construction: one fresh session + one transaction per output file (barrier
files: fresh session, no transaction).

## 10. pg-delta touchpoints (small, each with its own changeset)

- Export a public data-fingerprint utility (the `tableStats` fingerprint/count
  SQL from `src/proof/prove.ts`) — or extract it to a shared internal module —
  so pg-squash doesn't reimplement it.
- Verify `extract()`/`FactBase` (incl. `rootHash`) are exported from
  `src/index.ts`; add exports if missing.
- No changes to the diffing core.

## 11. Testing

- **Unit (no Docker):** ingest (splitting, transaction-control interpretation,
  opaque-file detection incl. COPY-inline-data), barrier/cluster-scope
  classifiers, packer (pure), emitter (inline snapshots of output files).
- **Corpus (Docker, primary gate):** scenarios = migration chains under
  `tests/corpus/`, each proven end-to-end (squash → dual replay → proof).
  Seed adversarial scenarios from day one: enum add-then-use across files,
  CREATE INDEX CONCURRENTLY mid-chain, `SET search_path` leak, CREATE ROLE +
  GRANT chains, temp `ON COMMIT DROP`, explicit BEGIN/COMMIT in input, create-
  then-drop churn, DML backfills with `now()` (exercises the volatility mask),
  an opaque COPY-FROM-stdin file.
- **Property harness:** take pg-delta corpus scenarios' `b.sql`, split the
  statements into a random chain of pseudo-migration files (seeded RNG), squash,
  prove ≡ replaying the whole file. Cheap coverage multiplier over an existing
  curated corpus.
- **CI:** wire into `.github/actions/detect-changes` + `tests.yml` like the
  siblings — `pg-squash-unit` (no Docker) and `pg-squash-corpus`
  (`PGDELTA_TEST_IMAGE`-style matrix; start PG 17-only, expand to 14–18 once
  stable). Supabase-image scenario behind the `PGDELTA_NEXT_SUPABASE_TESTS=1`
  convention.

## 12. Milestones

**M0 — scaffold + pure frontend (no Docker).**
Package scaffold mirroring pg-topo (dual exports, scripts, knip/oxlint/tsconfig
wiring, CI detect-changes entry); `model/` + `ingest/` + `classify/` + `pack/`
+ `emit/` with full unit coverage; **research task: pin the Supabase CLI's
exact per-file execution semantics** (session + transaction wrapping) in
`docs/` — it drives §7/§9.
*Acceptance:* unit tests green; `format-and-lint` + `check-types` + `knip`
green; packer proven minimal on synthetic inputs.

**M1 — engine happy path (Docker).**
`shadow/` (ClusterHandle, pool, ledger, checkpoints), `replay/` (runner
semantics, runtime barrier detection via 25001), `prove/equivalence`,
orchestrator; pg-delta touchpoints (§10); corpus bootstrapped with the
non-adversarial scenarios.
*Acceptance:* corpus green on PG 17; a 100-file synthetic chain squashes to 1
file in seconds on the shared test cluster.

**M2 — hardening.**
Repair loop + checkpointed retries; volatility mask; session-leak split repair;
refusal diagnostics; fresh-cluster fallback mode; property harness; full
adversarial corpus.
*Acceptance:* every adversarial scenario green across PG 14–18; property
harness green over ≥50 seeded random splits; kill-switch test (chain that
degenerates to original boundaries still passes proof).

**M3 — CLI + release.**
`pgsquash squash <dir> --out <dir>` with Docker-managed default cluster
(stock postgres or supabase image by flag) and `--cluster` injection for
pre-provisioned clusters; manifest output; README + docs; changesets;
CI matrix expansion; supabase-image integration test.
*Acceptance:* end-to-end CLI run on a real Supabase-project migration dir;
release-preview publishes.

## 13. Risks / open questions

- **Supabase CLI runner semantics** unverified — M0 research task; both repair
  strategy and reference replay depend on it.
- **Volatility mask granularity** (table vs column) — start per-table
  (mask = downgrade that table to count-only comparison), refine to per-column
  if corpus shows it's too coarse.
- **Ledger completeness** — v1 covers roles/memberships/role-settings; audit
  during M1 for other cluster-visible catalogs worth guarding
  (e.g. `pg_shdescription` comments on roles).
- **Extract baseline filtering** — supabase-image baselines contain platform
  objects; pg-squash compares two replays on identical baselines, so platform
  noise cancels out in rootHash equality. Verify this holds in the
  supabase-image scenario (M3).
- **Name**: `@supabase/pg-squash` (assumed; confirm before scaffold).
