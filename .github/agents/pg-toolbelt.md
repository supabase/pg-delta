---
# Fill in the fields below to create a basic custom agent for your repository.
# The Copilot CLI can be used for local testing: https://gh.io/customagents/cli
# To make this agent available, merge this file into the default repository branch.
# For format details, see: https://gh.io/customagents/config

name: pg-toolbelt
description: Specific agent to work on pg-toolbelt issues
---

# pg-toolbelt

## Overview

Bun-based monorepo containing PostgreSQL tooling packages.

> **Note:** `.github/agents/pg-toolbelt.md` is the canonical file. `AGENTS.md` and `CLAUDE.md` are symlinks pointing to it. Always edit the canonical file — changes will automatically reflect in all three.

## Packages

- **packages/pg-delta** (`@supabase/pg-delta`): PostgreSQL schema-diff and migration engine (a clean-room rewrite; the CLI binary is `pgdelta`). It extracts two schemas into a normalized, content-addressed **fact base** using a live/shadow Postgres, diffs generically, emits an ordered DDL plan, and **proves** the plan converges (state + data preservation) on a clone. See `packages/pg-delta/README.md` and `docs/architecture/` for depth.
- **packages/pg-topo** (`@supabase/pg-topo`): Topological sorting for SQL DDL statements. Pure library that accepts SQL content strings, extracts dependencies, and produces a deterministic execution order. Includes an optional filesystem adapter for discovering/reading `.sql` files. It is an **optional peer** of pg-delta (used only by the reorder-assist / `schema lint` frontends), never by the diffing core.
- **packages/pg-squash** (`@supabase/pg-squash`): Compress an ordered migration chain into the minimum number of transactions, with a proof of equivalence. Lives above pg-topo (verbatim split) and pg-delta (extract / fingerprints) so those packages keep their isolation rules. See `docs/roadmap/pg-squash-design.md`.

## Quick Reference

```bash
# Install all dependencies
bun install

# Build all packages (tsc -> dist for Node/Deno consumers)
bun run build

# Test specific package
bun run test:pg-delta          # pg-delta unit tests (bun test src/)
bun run test:pg-topo
bun run test:pg-squash

# Type check / lint / knip (all packages)
bun run check-types
bun run format-and-lint
bun run knip

# Run a single package's tests directly
cd packages/pg-delta && bun test src/     # Unit tests (no Docker)
cd packages/pg-delta && bun test tests/   # Integration tests (Docker required)
cd packages/pg-topo && bun run test       # All tests (Docker required)
cd packages/pg-squash && bun test src/    # Unit tests (no Docker)
cd packages/pg-squash && bun test tests/  # Integration tests (Docker required)

# Choose the Postgres image for pg-delta integration/corpus tests
PGDELTA_TEST_IMAGE=postgres:17-alpine bun test tests/engine.test.ts
```

## Architecture

- All three library packages are runtime-agnostic: importable in Bun, Node.js, or Deno.
- Conditional exports: the `bun` condition serves TypeScript source directly; `import`/`require`/`default` serve compiled `dist/` JS (produced by `bun run build` — `tsc` with `rewriteRelativeImportExtensions`, so the `.ts` import specifiers become `.js` on emit). `dist/` is gitignored; consumers get it from the published tarball.
- `pg-delta` uses the `pg` npm library for database connections (works in Bun via Node.js compat).
- `pg-topo` is pure static analysis — no runtime database dependency in the library itself.
- Integration tests use `testcontainers` to spin up PostgreSQL Docker containers.
- Oxc handles formatting and linting: `oxfmt` (config at `.oxfmtrc.json`) and `oxlint` (config at `.oxlintrc.json`).
- Changesets manage versioning across both packages.

### pg-delta: Postgres is the only elaborator

The engine never parses SQL to understand it. Every state is resolved by a real
PostgreSQL instance (a live DB, or a shadow DB loaded from `.sql` files) and read
back out of the catalog into a normalized, content-addressed fact base
(`src/core/fact.ts`, `src/core/hash.ts`, `src/core/stable-id.ts`). Diffing is
generic (`src/core/diff.ts`) — there are **no per-object-type change classes**.

- **Do not reach for an external SQL parser / AST library in the diffing path**
  (`src/core/**`, `src/extract/**`, `src/plan/**`). If you need a dependency edge,
  it comes from `pg_depend`, sourced at **extract time** in `src/extract/**` and
  carried on the fact as a dependency edge — never re-derived by parsing
  `pg_get_expr()` output while diffing.
- **Never semantically edit or regex-transform SQL text in the engine** —
  including `pg_get_functiondef` / `pg_get_expr` output and non-diffing replay
  paths such as seed and export. If a statement cannot be replayed verbatim in
  some context, skip the fact with a clear diagnostic or source structured data
  from the catalog (e.g. `pg_proc.proconfig`) to decide — never rewrite the DDL.
  The presentation-only formatter in `src/frontends/sql-format/**` is the sole
  exception: it may change casing and layout, never meaning, and its output is
  gated by `load(export(db)) ≡ db` fidelity coverage.
- `@supabase/pg-topo` is an **optional peer** used only by the dev-experience
  frontends (`src/frontends/sql-order.ts`, `schema lint`) — importing the core
  never pulls it in. `canReorder()` probes availability; absence throws
  `ReorderUnavailableError` with an install hint.
- Ordering falls out of the fact grain (cycles are structurally hard to form);
  the failure mode is a more verbose script, not an unsortable plan.
- Every plan is validated by the **proof loop** (`src/proof/prove.ts`): apply to
  a clone, re-extract, compare hashes (state proof) and check seeded rows survive
  (data proof). The corpus (`tests/engine.test.ts`) runs this end-to-end.

Integration/policy behavior lives in `src/policy/**` (baselines, extension
handlers) and `src/integrations/**` (profiles: `raw` | `supabase` | custom).
SQL rendering/formatting is in `src/frontends/sql-format/**` and `src/plan/render-sql.ts`.

## Test Patterns

### pg-delta unit tests

Standard `describe`/`test`/`expect` from `bun:test`. No database needed. Located in `packages/pg-delta/src/**/*.test.ts`. Run with `bun test src/`.

### pg-delta integration tests

Located in `packages/pg-delta/tests/**/*.test.ts`. They provision Postgres via
`testcontainers`, keyed on the `PGDELTA_TEST_IMAGE` env var (default
`postgres:17-alpine`). Use the helpers in `tests/containers.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "./containers.ts";
import { extract } from "../src/extract/extract.ts";

// createTestDb() gives an isolated database on the shared cluster singleton.
```

- The **corpus** (`tests/engine.test.ts`, scenarios under `corpus/`) is the
  primary correctness gate — see "corpus progress" below.
- Supabase-image tests (`supabase-*.test.ts`, `dbdev-*.test.ts`,
  `extension-intent-*.test.ts`, etc.) self-skip unless
  `PGDELTA_NEXT_SUPABASE_TESTS=1`; CI runs the stock-alpine path only.

### pg-topo tests

Use `bun:test` with testcontainers for PostgreSQL validation. Located in `packages/pg-topo/test/`.

- `test/global-setup.ts` is preloaded to pull Docker images.
- `test/support/postgres/postgres-container.ts` owns container lifecycle (Bun's native `SQL` class).
- Unit tests pass inline SQL strings to `analyzeAndSort(sql: string[])`.
- Integration tests use `analyzeAndSortFromFiles(roots)` or `analyzeAndSortFromRandomizedStatements` for filesystem fixtures.

## pg-topo internals

A 6-stage pipeline: **parse → classify → extract → build graph → topological sort → result**.

| Directory | Responsibility |
|---|---|
| `src/ingest/parse.ts` | SQL content parsing (plpgsql-parser), no filesystem |
| `src/classify/` | Statement classification (40 types) |
| `src/extract/` | Dependency extraction from the AST |
| `src/graph/` | Graph building + topological sort (Kahn's algorithm) |
| `src/annotations/` | `-- pg-topo:` comment directive parsing |
| `src/model/` | Core types and `ObjectRef` identity |
| `src/from-files.ts` | Filesystem adapter (discovery + read, delegates to core) |
| `src/ingest/discover.ts` | `.sql` discovery — used only by the from-files adapter |

Cyclic input is not an error: the sort falls back to a deterministic cycles-last
order and reports `CYCLE_DETECTED`, which callers **must** handle before
executing the result directly.

```typescript
import { analyzeAndSort, analyzeAndSortFromFiles } from "@supabase/pg-topo";

// Pure library (no filesystem)
const { ordered, diagnostics, graph } = await analyzeAndSort([
  "create table app.users(id int primary key);",
  "create view app.user_ids as select id from app.users;",
]);

// Filesystem adapter (discovers and reads .sql files)
const result = await analyzeAndSortFromFiles(["./sql/"]);
```

## Changesets

All code changes that affect package behavior must include a changeset. **When making a fix, feat, or any user-facing change (patch/minor/major), add a changeset** — do not merge or consider the work complete without one.

Use the changeset CLI to generate one:

```bash
bunx changeset
```

This will prompt you to select affected packages and choose the version bump type (`patch` for fixes, `minor` for new features, `major` for breaking changes). Commit the generated `.changeset/*.md` file alongside your code changes. Changesets automate versioning and releases on merge to main. The repo is in changesets **pre/alpha mode** (`.changeset/pre.json`): a `major`/`minor`/`patch` bump increments the `-alpha.N` counter rather than the base version.

## Conventional Commits

All PR titles and commit messages **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) convention:

```text
<type>(<scope>): <description>

# Examples
feat(pg-delta): add support for materialized views
fix(pg-topo): correct cycle detection in dependency graph
chore: update oxlint config
docs(pg-delta): improve README examples
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`.

The `Lint Pull Request` CI check (see `.github/workflows/lint-pull-request.yml`) runs `amannn/action-semantic-pull-request` and will fail any PR whose title doesn't match this convention. Two common pitfalls to avoid:

- **Auto-generated PR titles from external tools** (Claude Code web session launcher, GitHub's "compare" UI, the `gh` CLI default, etc.) routinely produce plain English like `Add integration tests for X` or `Update Y`. These will fail lint. Always verify the PR title before considering the PR opened — if it's not `<type>(<scope>): ...`, rename it (e.g. via `mcp__github__update_pull_request` with a new `title`). The first commit's subject is usually a good source since we write those in Conventional Commits already.
- **`<scope>` should be the package name** (`pg-delta`, `pg-topo`, `pg-squash`) or a cross-cutting area (`ci`, `docs`, `release`) — not a feature name.
- **Link the fixed issue(s) in the PR description.** When the PR resolves or addresses a tracked issue, include a GitHub closing keyword line in the description (for example `Closes #230`, `Fixes supabase/pg-toolbelt#230`, or `Refs #230` for partial work). This auto-closes the issue on merge and gives reviewers one click back to the bug report. If the work spans multiple issues, list them all (`Closes #230, Closes #231`).

## CI

- GitHub Actions with `dorny/paths-filter` detects which packages changed (`.github/actions/detect-changes`). Only affected packages are tested.
- pg-delta test jobs in `.github/workflows/tests.yml`:
  - `pg-delta-unit` — `bun test src/`.
  - `pg-delta-corpus` — the proof loop (`tests/engine.test.ts`), matrix of **PG 14–18 × 10 shards** (`PGDELTA_TEST_IMAGE` + `PGDELTA_NEXT_SHARD`), each shard running scenarios with in-job concurrency (`PGDELTA_NEXT_CONCURRENCY=4`, matched to the 4-vCPU public-repo runners).
  - `pg-delta-integration` — everything except the corpus loop, matrix of **PG 14–18 × 5 file groups**. The wall-time-dominating files are pinned to groups 0/1 in the workflow's split script; all other files (including new ones) round-robin into groups 2/3/4. If a test file grows to dominate its group (check the job timings), move it to a pinned group.
  - `pg-delta-integration-pg15-compat` / `pg-delta-integration-pg17-compat` — stable status-check names (for branch protection) that aggregate the corpus + integration matrices.
- pg-squash test jobs in `.github/workflows/tests.yml`:
  - `pg-squash-unit` — `bun test src/`. Runs when pg-squash, pg-delta, or pg-topo change.
  - `pg-squash-corpus` — `bun test tests/` (shadow/replay integration + corpus), PG 17-only until the engine is stable, then expand to 14–18. Same change filter as unit tests.
- `check-types` and `format-and-lint` build `@supabase/pg-topo` first, because pg-delta type-checks its optional peer through pg-topo's gitignored `dist/*.d.ts`.
- Changesets automate releases on merge to main; `release-preview` publishes a `pkg-pr-new` preview of pg-delta, pg-topo, and pg-squash.

When changing shard count or PG versions, update all of these locations:

- `.github/workflows/tests.yml` — the `postgres_version` list and `shard` list in `pg-delta-corpus`, and the `postgres_version` + `group` lists in `pg-delta-integration`.
- This file (`AGENTS.md` / `CLAUDE.md`) — both the CI section and the Testing Discipline section.

### Coverage

Local coverage is produced by the `@supabase/bun-istanbul-coverage` preload,
which instruments the source globs in `.nycrc.json` (both packages' `src/`) and
writes per-process istanbul JSON to `NYC_OUTPUT_DIR`. Each package's
`scripts/run-tests.ts` injects that preload **only when `BUN_COVERAGE=1`** and is
otherwise a transparent passthrough to `bun test` (so CI, which calls `bun test`
directly, is unaffected).

```bash
bun run coverage                         # pg-topo + pg-delta (unit + integration + corpus), then nyc report
bun run coverage --unit-only             # skip pg-delta's slow integration + corpus (pg-topo still runs; Docker required)
bun run coverage --pg-image postgres:17-alpine   # pin the PG image for pg-delta integration/corpus
bun run coverage --skip-tests            # regenerate the report from an existing .nyc_output
```

Reports land in `.coverage-artifacts/` (HTML/lcov/json-summary). Docker is
required — pg-topo and pg-delta integration/corpus use testcontainers.

CI uploads **pg-topo coverage only** (`pg-delta-*` jobs run without
`BUN_COVERAGE`); pg-delta coverage is a local-on-demand tool by choice, because
instrumenting the corpus PG-version × shard matrix in CI is disproportionately
costly. To restore pg-delta coverage in CI, set `BUN_COVERAGE=1` +
`NYC_OUTPUT_DIR` on the `pg-delta-*` jobs and upload their `.nyc_output` as a
`coverage-*` artifact (the aggregation job already merges everything matching
`coverage-*`).

## Agent Workflow

### Plan Before Acting

Before making any code changes, present a plan describing:

- What files will be modified or created
- What the approach is
- What tests will be added or updated

Wait for user approval before implementing.

### Changesets for fix/feat/major/minor

When implementing a **fix**, **feat**, or any change that affects package behavior (patch/minor/major), add a changeset before considering the work complete. Run `bunx changeset`, select the affected package(s), pick the appropriate bump type, and commit the generated `.changeset/*.md` file with your changes.

See also **Test-Driven Fixes** below — the regression test must exist (and fail) before the fix that the changeset describes.

### Test-Driven Fixes

Every bug fix and every feature with a well-defined acceptance criterion follows a strict RED → GREEN cycle:

1. **RED first.** Author the regression test(s) against the current (broken) code. Run the focused test and confirm it **fails for the right reason** — an assertion mismatch, a missing symbol, or a runtime error that matches the bug. A test that fails because of a typo or wrong import does not count.
2. **Capture the failure.** Save the assertion excerpt or test-runner summary (just the relevant lines). This goes into the follow-up commit message and/or PR description so reviewers can see the regression was real.
3. **GREEN.** Apply the production change. Re-run the same focused test and confirm it passes.
4. **No regressions.** Run the broader focused suites for the package(s) you touched (unit tests, and integration tests / the corpus for the affected area when iterating locally) plus `bun run format-and-lint:fix && bun run check-types && bun run knip` (never `knip --fix` — see Common Issues).

**Commit shape.** Prefer splitting the work into two commits on the working branch:

- `test(<scope>): add failing regression for <behavior>` — tests only; reviewers can check out this commit and watch it fail.
- `fix(<scope>): <what changed>` — production change (and the changeset, agent-guideline updates, etc.). The commit message should include the captured RED output from step 2.

If a repository policy or reviewer asks for a single squashed commit, keep the RED/GREEN split in the PR description instead — do not silently collapse the evidence.

**Applies to:**

- All `fix:` commits, with no exceptions.
- `feat:` commits where the behavior has a concrete, testable acceptance criterion. Start from a failing test by default; skip only when the feature is purely additive plumbing with no observable-yet behavior.
- Refactors that claim to preserve behavior: if there is doubt, pin the current behavior with a passing test first, then refactor.

**Don't:** write the production code first and then "backfill" a test that already passes. That test cannot prove the fix was necessary.

### Testing Discipline

pg-delta has a large integration + corpus suite across PG 14–18. Never run the full suite while iterating.

**During development:**

- pg-topo: `cd packages/pg-topo && bun run test` is fine (small test suite).
- pg-delta unit tests: `cd packages/pg-delta && bun test src/<path-to-specific-test>.test.ts`.
- pg-delta integration tests: `cd packages/pg-delta && bun test tests/<specific-file>.test.ts` — one file at a time.
- Run a single test within a file: `bun test --test-name-pattern "<pattern>" <file>`.
- Pick the PG image to speed up iteration: `PGDELTA_TEST_IMAGE=postgres:17-alpine bun test tests/<file>`.

**Final validation only:**

- Run `bun run test:pg-delta` (unit) plus a full corpus run for at least one PG version after all changes are complete and targeted tests pass.

### Test container hygiene & corpus progress

**No leaked containers.** Integration tests use testcontainers, whose Ryuk
reaper removes a run's containers when the test process dies. **Keep Ryuk
enabled** — never set `TESTCONTAINERS_RYUK_DISABLED`. Leaks still accumulate when
the Docker daemon restarts (orphaning what Ryuk tracked) or a run is killed
before Ryuk connects, and the shared cluster singletons in
`packages/pg-delta/tests/containers.ts` are not stopped explicitly.
Reclaim orphans with:

```bash
cd packages/pg-delta
bun run docker:clean            # remove testcontainers older than 60m (safe during an active run)
bun run docker:clean --dry-run  # preview only
bun run docker:clean --all      # remove ALL testcontainers — only when no tests are running
```

It targets only the `org.testcontainers=true` label and is age-guarded, so a run
in flight is never touched. Good as a periodic / CI post-step. Check for leaks
with `docker ps` (look for many idle `postgres:1[58]-alpine` containers hours/days old).

**Run the corpus to validate engine/planner changes — it is cheap.** The full
corpus (every scenario, both directions) is **~2–3 min per PG version** (e.g.
420 cases in ~150s on `postgres:17-alpine`). Any change to the diff / planner /
compaction / proof path should be gated on a full corpus run for at least one PG
version before you call it "no regressions" — focused suites + blast-radius
reasoning are not a substitute, because the corpus is the only thing that proves
every scenario still applies and converges. A cosmetic compaction change in
particular fires across many unrelated scenarios, so reason about it, then run
the corpus.

```bash
PGDELTA_TEST_IMAGE=postgres:17-alpine bun test tests/engine.test.ts
```

**Live corpus progress.** `bun test` buffers its own reporter when stdout is a
pipe, so a piped/background corpus run prints nothing until it finishes (still a
short wait, but a background/CI run shows no interim signal). Set
`PGDELTA_NEXT_PROGRESS=1` to stream a
`corpus <image> [done/total pct%] PASS|FAIL <scenario>` line per scenario to
stderr (a raw fd-2 write that bypasses the buffering). Off by default so an
interactive TTY run keeps bun's native reporter clean.

```bash
PGDELTA_NEXT_PROGRESS=1 PGDELTA_TEST_IMAGE=postgres:17-alpine bun test tests/engine.test.ts
```

### Running integration tests in a sandbox (no systemd, no Docker daemon)

Cloud sandboxes (e.g. Claude Code on the web) typically ship with the Docker
client installed but no running daemon and no registry credentials. If
`docker info` reports `Cannot connect to the Docker daemon`, set it up
yourself instead of giving up and skipping integration coverage:

1. **Start `dockerd` directly** (no systemd in these sandboxes — `systemctl`
   and `/etc/init.d/docker` will both fail with `Operation not permitted`):

   ```bash
   sudo dockerd > /tmp/dockerd.log 2>&1 &
   sleep 5
   docker info | grep "Server Version"   # confirm the daemon is up
   ```

2. **Configure a registry mirror before pulling.** Anonymous Docker Hub pulls
   are rate-limited per source IP and the limit is reached almost immediately
   on shared CI/sandbox egress. `mirror.gcr.io` is a Google-hosted pull-through
   cache for Docker Hub `library/*` and other public images and works without
   credentials:

   ```bash
   sudo mkdir -p /etc/docker
   echo '{"registry-mirrors": ["https://mirror.gcr.io"]}' | sudo tee /etc/docker/daemon.json
   sudo pkill dockerd; sleep 2
   sudo dockerd > /tmp/dockerd.log 2>&1 &
   sleep 5
   docker info | grep -A1 "Registry Mirrors"   # confirm
   ```

3. **Pre-pull only the image you need**, then point the tests at it:

   ```bash
   docker pull postgres:17-alpine
   cd packages/pg-delta
   PGDELTA_TEST_IMAGE=postgres:17-alpine bun test tests/<file>.test.ts
   ```

   Supabase-image tests self-skip unless `PGDELTA_NEXT_SUPABASE_TESTS=1`, so the
   stock-alpine image is enough for the corpus and most integration files. The
   `security-label-proof` test builds the `dummy-seclabel.Dockerfile` inline via
   testcontainers; it self-skips (`skipSeclabelProof`) when that build can't run.

If you cannot get Docker running (e.g. the sandbox blocks `dockerd`'s
networking even with the mirror), say so explicitly in your final report — do
not silently skip the integration step. For fast unit-only feedback you can run
`bun test src/` (no Docker needed).

### Upgrading Supabase test images

When changing the Supabase image pinned in `packages/pg-delta/tests/containers.ts`
(`SUPABASE_IMAGE`), treat the generated Supabase baseline fixtures as part of the
upgrade.

- Do **not** hand-edit `packages/pg-delta/tests/fixtures/supabase-base-init/*.sql`.
  Regenerate them with the maintainer script:
  `cd packages/pg-delta && bun run sync-base-images`.
- The Supabase-image integration tests (`supabase-*.test.ts`, `dbdev-*.test.ts`,
  `extension-intent-*.test.ts`, `profile-e2e-*.test.ts`) require
  `PGDELTA_NEXT_SUPABASE_TESTS=1` and the `SUPABASE_IMAGE` pulled locally. Run
  them after an image change before considering the upgrade done.
- If the sync reveals new schemas, roles, grants, or comments, update pg-delta's
  Supabase handling (`src/integrations/**`, `src/policy/**`, or the relevant
  extraction/diff logic) instead of hand-editing the generated SQL fixture.

### Test Coverage Expectations

All code changes must be covered by tests:

- Unit tests go in `src/` next to the code (e.g., `src/plan/rules/helpers.test.ts`).
- Integration tests go in `tests/` using the `tests/containers.ts` helpers.
- **pg-delta:** Every fix or feat must be covered end-to-end. Prefer adding or
  extending a **corpus scenario** (`corpus/<name>/{a,b}.sql`) so the proof loop
  exercises it in both directions, rather than a hand-rolled plan+apply assertion.
  Use a focused integration test only when validating engine internals the corpus
  cannot express.
- **Seed corpus tables so the data-preservation proof has teeth.** The proof
  loop auto-seeds each empty kept table with `INSERT … DEFAULT VALUES`, but a
  table with a NOT NULL-without-default / FK / unique / check column cannot be
  seeded that way and stays EMPTY — getting zero fingerprint/count coverage.
  When you add or extend a scenario whose tables can't take the default insert,
  ship seed files: `corpus/<name>/seed.sql` (INSERTs against `a.sql`, applied in
  the FORWARD direction) and `corpus/<name>/seed-b.sql` (against `b.sql`, applied
  in REVERSE) with one minimal row per such table, so the proof actually
  fingerprints real data. Adding an `autoseed-allowlist.ts` entry is the
  **fallback** for tables that genuinely cannot or should not be seeded (e.g. a
  BEFORE INSERT trigger that suppresses the row, or a scenario whose whole point
  is a constraint interplay) — not the default.
- Author tests **before** the production change per **Test-Driven Fixes** above — a new test that has never failed does not prove the regression was real.

### Snapshot Assertions

Prefer `toMatchInlineSnapshot` over `toBe` or `toEqual` when asserting SQL output in integration tests. Inline snapshots make the expected SQL immediately visible in the test file, improving readability and making regressions obvious at a glance.

```typescript
expect(result.sql).toMatchInlineSnapshot(`
  "ALTER TABLE foo ADD COLUMN bar integer;"
`);
```

Start with an empty inline snapshot assertion, run the test once so Bun fills in the expected value automatically, and update snapshots intentionally with `bun test -u <file>`.

### Kaizen (Continuous Improvement)

Whenever you are told you made a mistake — whether in commands, coding style, or guidelines — extract a generalizable lesson and propose a change to these agent guidelines so the same mistake does not happen again.

### Automated-review loops (Codex and similar bots)

Automated reviews are **signals, not truth**. Findings can be valid, mistaken,
overly cautious, out of scope, or outright hallucinated — validate each one
against the actual code, the intended behavior, its risk, and the PR's scope
before acting. Bot reviewers re-review every push and will keep finding
locally-valid issues forever — including issues that exist only in your
previous round's fix. Left unchecked this compounds into scope creep (real
incident: PR #368 grew from a ~200-line fix to ~1,700 lines over 12 review
rounds before being trimmed back). Rules of engagement:

- **Cap the loop.** After ~2–3 rounds of bot findings on the same PR, stop
  auto-fixing. Re-read the remaining findings as a set and ask: are these still
  about the issue being fixed, or are they re-litigating a broader contract
  (error handling, hardening, performance) one corner at a time?
- **Scope test per finding.** Fix it in the PR only if it is (a) a defect in
  code this PR adds, AND (b) reachable without an adversarial or wildly
  unusual setup. Pre-existing behavior the PR merely touched, and hardening
  against threat models the surrounding code doesn't defend against, get
  recorded instead of fixed.
- **Push back when appropriate.** Do not expand the PR for speculative,
  highly unusual, pre-existing, or disproportionate concerns. If a finding is
  too far-fetched for the current scope, explain why on the thread and defer
  it — a well-argued deferral is a first-class outcome, not an evasion.
- **Record instead of re-fixing.** Deliberately-deferred findings go in
  `docs/roadmap/pg-delta-next-follow-ups.md` (see the per-PR triage sections
  there, e.g. "PR #368 review triage"). Reply to the bot thread with a link to
  that section — never silently ignore a finding, and never fix it just to
  make the thread go away.
- **Escalate.** When the loop stops being productive, say so on the PR and
  hand it to a human reviewer with a summary of what was fixed vs deferred.

Principle: review feedback should **inform** engineering judgment, not replace
it. Fix real problems, document reasonable follow-ups, and push back when the
requested change is not justified by the current scope.

### Common Issues

- Lint errors can usually be detected and auto-fixed by running `bun run format-and-lint:fix && bun run check-types && bun run knip`. Run this after you finish code changes to ensure you don't introduce lint errors into the project.
- **Never run `knip --fix`, and never delete an export because knip reports it "unused".** Both packages are consumed as libraries, so an export with no in-repo importer can still be a consumer's API; that's exactly why `knip.json` demotes the `exports`/`types` rules to `"warn"` (report-only, doesn't fail CI). `knip --fix` promotes those warnings into deletions and strips the `export` keyword repo-wide. Only the error-severity findings (e.g. unused dependencies) gate CI — fix those by hand (or via a targeted `knip.json` entry such as `ignoreDependencies` when knip can't see a reference, e.g. `import.meta.resolve(...)`). (Real incident: `knip --fix` stripped 9 library exports across 15 files; a reviewer had to ask for them back.)
- `bun run check-types` and `bun run knip` need `packages/pg-topo/dist` to exist (`bun run build` first) — without it, type-checking fails with `Cannot find module '@supabase/pg-topo'` spurious errors. The knip CI job runs *without* that build, so when verifying knip locally, match CI by temporarily removing `packages/pg-topo/dist`.
- **Never revert `oxfmt` / `oxlint --fix` output to keep a diff scoped.** The `Format and lint` CI check runs `oxfmt --check` over the whole repo, so any formatting drift the auto-fixer touched — even on lines you didn't author — fails CI once the branch merges. If the formatter reformats unrelated/pre-existing lines, keep those changes; if you want to isolate them, commit the formatting-only changes as a separate `chore`/`style` commit rather than reverting them. (Real incident: an implementer reverted an `oxfmt` ternary rewrap "to keep the diff scoped"; the drift shipped in the squash-merge and failed `Format and lint` on the downstream PR.)
