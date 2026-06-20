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

- **packages/pg-delta** (`@supabase/pg-delta`): PostgreSQL schema diff and migration tool. Compares two live databases and generates DDL migration scripts.
- **packages/pg-topo** (`@supabase/pg-topo`): Topological sorting for SQL DDL statements. Pure library that accepts SQL content strings, extracts dependencies, and produces a deterministic execution order. Includes an optional filesystem adapter for discovering/reading `.sql` files.
- **packages/postgrest-typegen** (`@supabase/postgrest-typegen`): Type generation for PostgREST from a PostgreSQL schema (the engine behind `supabase gen types`, extracted from postgres-meta). Hard split between introspection (`introspect(db)` → `GeneratorMetadata`) and pure generation (`generateTypescript`/`generateGo`/`generatePython`/`generateSwift`); `GeneratorMetadata` is the pluggable contract. `GeneratorMetadata`/`Postgres*` types are derived from ArkType schemas in `src/types.ts` (single source of truth; a compile-time equivalence test pins the inferred types to the frozen interface contract), and `parseGeneratorMetadata` is an opt-in runtime validator — never baked into `introspect()`. Output must stay byte-identical to postgres-meta's templates (prettier pinned exact to 3.5.3) until parity is released.

## Quick Reference

> **Important:** Always use `bun run test`, never bare `bun test`. The `test` script in `package.json` includes required flags.

```bash
# Install all dependencies
bun install

# Build all packages
bun run build

# Test all packages
bun run test

# Test specific package
bun run test:pg-delta
bun run test:pg-topo

# Type check all
bun run check-types

# Lint and format all
bun run format-and-lint

# Run a single package's tests directly
cd packages/pg-delta && bun run test src/     # Unit tests only
cd packages/pg-delta && bun run test tests/   # Integration tests (Docker required)
cd packages/pg-topo && bun run test           # All tests (Docker required)

# Test against a specific PostgreSQL version
PGDELTA_TEST_POSTGRES_VERSIONS=17 bun run test tests/
```

## Architecture

- Both packages are runtime-agnostic: importable in Bun, Node.js, or Deno
- Conditional exports: `bun` condition serves TypeScript source directly, `import` serves compiled JS
- `pg-delta` uses the `pg` npm library for database connections (works in Bun via Node.js compat)
- `pg-topo` is pure static analysis — no runtime database dependency in the library itself
- Integration tests use `testcontainers` to spin up PostgreSQL Docker containers
- Oxc handles formatting and linting: `oxfmt` (config at `.oxfmtrc.json`) and `oxlint` (config at `.oxlintrc.json`)
- Changesets manage versioning across both packages

### pg-delta core is self-contained

`pg-delta`'s core diffing / planning path (`src/core/objects/**`, `src/core/catalog*`, `src/core/plan/**`, `src/core/sort/**`) must stay runnable from **pg_catalog + its own utilities only**. Do not reach into `@supabase/pg-topo` — or any other SQL-parser / AST library — from this path, even as a "best-effort" helper.

When a change class needs dependency edges for `requires` or `creates`:

1. **First, check `pg_depend`.** Postgres records expression-level dependencies automatically (policy `USING` / `WITH CHECK` via `recordDependencyOnExpr`, `CHECK` constraints, generated columns, column defaults, view rewrite rules, trigger functions, SQL-language function bodies, sequence ownership, etc.). That catalog is authoritative and already used extensively in `src/core/depend.ts`; extend it instead of inventing a second source of truth.
2. **Source the list at extract time.** Join `pg_depend` in the object's extractor (`<object>.model.ts`) so the resolved schema+name (or stable-id) list is carried on the model. The change class then iterates that list in `requires` — no parsing happens while diffing.
3. **Keep derived metadata out of `dataFields`.** Fields populated from `pg_depend` change lockstep with their source expression (`using_expression`, `with_check_expression`, etc.), so including them in equality adds no signal and creates noisy diffs.
4. **Don't re-parse what Postgres already parsed.** Re-parsing `pg_get_expr()` output with an external AST library to recover references is a sign you missed a `pg_depend` row. Find it.

`pg-topo` is fine as a **dev-time** utility inside pg-delta — for example, `src/core/test-utils/assert-valid-sql.ts` uses `validateSqlSyntax` to sanity-check serialized DDL in unit tests. That usage is scoped to tests and does not leak into the diffing path.

### Serialize Options

When adding or changing a serialize option in `pg-delta`, keep the typing and ownership split consistent:

- Define the shared serializer option fields in `packages/pg-delta/src/core/integrations/serialize/serialize.types.ts`. This file is the single source of truth for `SerializeOptions`.
- If an option is only relevant to one change family, derive a local alias from the shared type in `serialize.types.ts` with `Pick<...>` (for example `SchemaSerializeOptions` or `ExtensionSerializeOptions`) instead of creating a new standalone options type.
- Do not define a separate local `SerializeOptions` type in `packages/pg-delta/src/core/integrations/serialize/dsl.ts`. The DSL should import the shared type and pass it through.
- `packages/pg-delta/src/core/objects/base.change.ts` should expose `serialize(options?: SerializeOptions)`.
- Concrete change classes under `packages/pg-delta/src/core/objects/**/changes/*.ts` must accept either the shared `SerializeOptions` or a derived alias, even when the option is unused. Use `_options?: SerializeOptions` for unused parameters so the full `Change` union accepts `change.serialize(rule.options)`.
- Keep product-specific serialization behavior in integrations such as `packages/pg-delta/src/core/integrations/supabase.ts` unless the behavior is truly generic for all users. Integration-specific rules belong in the serialize DSL before they belong in core change logic.
- Do not redesign the global serializer options as a union of per-change option types unless the serialize DSL itself is also being redesigned to tie `when` clauses to specific change subtypes. With the current free-form `FilterPattern`, one shared global contract is the intended model.

When adding a new serialize option, update tests at the same time:

- Add or update focused coverage in `packages/pg-delta/src/core/integrations/serialize/dsl.test.ts`.
- Add or update the relevant object serializer test next to the concrete change class (for example `extension.create.test.ts`).
- If the behavior is user-facing, update one existing end-to-end regression or add one targeted integration test. Prefer reusing an existing regression over creating duplicate integration coverage.

## Test Patterns

### pg-delta unit tests

Standard `describe`/`test`/`expect` from `bun:test`. No database needed. Located in `packages/pg-delta/src/**/*.test.ts`.

### pg-delta integration tests

Use `withDb(pgVersion, callback)` / `withDbIsolated(pgVersion, callback)` wrapper from `tests/utils.ts`. Located in `packages/pg-delta/tests/**/*.test.ts`.

```typescript
import { describe, test } from "bun:test";
import { withDb } from "../utils.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`my feature (pg${pgVersion})`, () => {
    test(
      "test name",
      withDb(pgVersion, async (db) => {
        // db.main and db.branch are pg Pool instances
      }),
    );
  });
}
```

### pg-topo tests

Use `bun:test` with testcontainers for PostgreSQL validation. Located in `packages/pg-topo/test/`.

## Changesets

All code changes that affect package behavior must include a changeset. **When making a fix, feat, or any user-facing change (patch/minor/major), add a changeset** — do not merge or consider the work complete without one.

Use the changeset CLI to generate one:

```bash
bunx changeset
```

This will prompt you to select affected packages and choose the version bump type (`patch` for fixes, `minor` for new features, `major` for breaking changes). Commit the generated `.changeset/*.md` file alongside your code changes. Changesets automate versioning and releases on merge to main.

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
- **`<scope>` should be the package name** (`pg-delta`, `pg-topo`) or a cross-cutting area (`ci`, `docs`, `release`) — not a feature name.
- **Link the fixed issue(s) in the PR description.** When the PR resolves or addresses a tracked issue, include a GitHub closing keyword line in the description (for example `Closes #230`, `Fixes supabase/pg-toolbelt#230`, or `Refs #230` for partial work). This auto-closes the issue on merge and gives reviewers one click back to the bug report. If the work spans multiple issues, list them all (`Closes #230, Closes #231`).

## CI

- GitHub Actions with `dorny/paths-filter` detects which packages changed
- Only affected packages are tested
- pg-delta integration tests are sharded across 15 runners x 3 PG versions
- pg-topo and postgrest-typegen each have a single `*-tests` job (Docker required); postgrest-typegen's integration/parity tests spin up a PostgreSQL container via testcontainers
- Changesets automate releases on merge to main

When changing shard count or PG versions, update all of these locations:

- `.github/workflows/tests.yml` — `shard_index`, `shard_total` in the matrix; the `pg-delta-build-test-images` matrix (`postgres_version`, `alpine_tag`, `pg_branch`) **must** stay in sync with `ALPINE_TAG_FOR_PG_MAJOR` in `packages/pg-delta/tests/alpine-tags.ts`
- `scripts/coverage.ts` — default `--shards` value (doc comment + code)
- This file (`AGENTS.md` / `CLAUDE.md`) — both the CI section and the Testing Discipline section

### Prebuilt `dummy_seclabel` test image

The `pg-delta-test:<major>` postgres image (which preloads the
`dummy_seclabel` contrib so integration tests can exercise
`SECURITY LABEL`) is **prebuilt once per PG version on GHCR** rather than
rebuilt by every shard. The flow:

1. `pg-delta-test-image-hash` job hashes
   `packages/pg-delta/tests/dummy-seclabel.Dockerfile` +
   `packages/pg-delta/tests/alpine-tags.ts` and decides whether the
   run can push (same-repo) or must fall back to inline builds (forked PR).
2. `pg-delta-build-test-images` (matrix on PG version) probes
   `ghcr.io/<repo>/pg-delta-test:<major>-<hash>` with
   `docker manifest inspect`; if missing, it builds with `buildx`
   (GitHub Actions cache) and pushes.
3. Each `pg-delta-integration` shard logs into GHCR, pulls the prebuilt
   image, and retags it locally as `pg-delta-test:<major>`. The
   `image.exists(...)` short-circuit in
   `packages/pg-delta/tests/postgres-alpine.ts::buildPostgresTestImage`
   then skips the docker build entirely.
4. On forked PRs the prebuild is skipped and `buildPostgresTestImage`
   builds inline at test time (current behavior). `getBuildInvocationCount()`
   in that file is exposed only so `tests/postgres-alpine.test.ts` can
   verify the short-circuit doesn't regress.

When you change `dummy-seclabel.Dockerfile` or `ALPINE_TAG_FOR_PG_MAJOR`,
the hash flips automatically and the next CI run rebuilds + republishes;
no manual cache invalidation is needed. If you add a new PG version,
update **all three** of: `ALPINE_TAG_FOR_PG_MAJOR` in `tests/alpine-tags.ts`, the
`pg-delta-build-test-images` matrix in `tests.yml`, and the
`postgres_version` list in `pg-delta-integration` / `pg-delta-unit` /
the compat aggregator jobs.

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
4. **No regressions.** Run the broader focused suites for the package(s) you touched (unit tests, and integration tests for the affected area when iterating locally) plus `bun run format-and-lint:fix && bun run check-types && bun run knip --fix`.

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

pg-delta has 45+ integration test files across 3 PG versions, sharded across 15 CI runners. Never run the full suite while iterating.

**During development:**

- pg-topo: `cd packages/pg-topo && bun run test` is fine (small test suite)
- pg-delta unit tests: `cd packages/pg-delta && bun run test src/<path-to-specific-test>.test.ts`
- pg-delta integration tests: `cd packages/pg-delta && bun run test tests/integration/<specific-file>.test.ts` — one file at a time
- Run a single test within a file: `bun run test --test-name-pattern "<pattern>" <file>`
- Limit PG versions to speed up iteration: `PGDELTA_TEST_POSTGRES_VERSIONS=17 bun run test tests/integration/<file>`

**Final validation only:**

- Run `bun run test:pg-delta` (full suite) only after all changes are complete and targeted tests pass

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

3. **Pre-pull only the images you need.** `tests/global-setup.ts` pulls *all*
   Alpine + Supabase tags listed in `tests/constants.ts` at startup. Always
   limit the matrix with `PGDELTA_TEST_POSTGRES_VERSIONS=17` (or `15`) so the
   preload only fetches the tags relevant to your run:

   ```bash
   docker pull postgres:17.6-alpine
   docker pull supabase/postgres:17.6.1.107   # only if your test uses withDbSupabase*
   ```

4. **Skip the `dummy_seclabel` image with `PGDELTA_SKIP_DUMMY_SECLABEL_BUILD=1`.**
   The default integration path requires the `pg-delta-test:<major>` image
   (stock alpine + the upstream `dummy_seclabel` test contrib so SECURITY
   LABEL tests can run). CI prebuilds it and uploads to
   `ghcr.io/supabase/pg-toolbelt/pg-delta-test:<major>-<hash>`. In sandboxes
   you usually cannot get it either way:

   - `pkg-containers.githubusercontent.com` (where GHCR keeps the actual
     blobs) is typically *not* on the Claude Code web egress allow-list, so
     `docker pull ghcr.io/supabase/pg-toolbelt/pg-delta-test:...` fails with
     `403 Forbidden` even though the package is public.
   - Building locally from `dummy-seclabel.Dockerfile` fetches
     `https://dl-cdn.alpinelinux.org/` over TLS, which the sandbox also
     intercepts (`TLS: server certificate not trusted`), so `apk add` fails
     before `dummy_seclabel.so` can be compiled.

   `buildPostgresTestImage` in `packages/pg-delta/tests/postgres-alpine.ts`
   honors `PGDELTA_SKIP_DUMMY_SECLABEL_BUILD=1` (or `true`) by returning the
   plain `postgres:<alpine_tag>` image instead. The container constructor
   already gates the `shared_preload_libraries=dummy_seclabel` flag on the
   tag prefix, so stock alpine boots cleanly. The two test files that
   actually need the module (`tests/integration/security-label-operations.test.ts`,
   `tests/integration/security-label-filter.test.ts`) skip themselves via
   `describe.skipIf(...)` when the flag is set; `tests/postgres-alpine.test.ts`
   (which asserts the `pg-delta-test:` tag) does too. **Never set this flag
   in CI** — security-label coverage would silently disappear.

5. **Run integration tests as usual** — the global-setup will reuse the cached
   images:

   ```bash
   cd packages/pg-delta
   PGDELTA_SKIP_DUMMY_SECLABEL_BUILD=1 \
   PGDELTA_TEST_POSTGRES_VERSIONS=17 \
     bun run test tests/integration/<file>.test.ts
   ```

If you cannot get Docker running (e.g. the sandbox blocks `dockerd`'s
networking even with the mirror), say so explicitly in your final report —
do not silently skip the integration step. For unit-only iteration, you can
bypass the bunfig `preload` (which loads `tests/global-setup.ts` and tries to
contact the Docker daemon) by invoking `bun test` from outside the package
directory:

```bash
cd /tmp && bun test /home/user/pg-toolbelt/packages/pg-delta/src/...
```

This is a workaround for fast unit-test feedback only; integration tests
still need a working Docker daemon.

### Upgrading Supabase test images

When changing `packages/pg-delta/tests/constants.ts`, especially
`POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG`, treat the generated Supabase
baseline fixtures as part of the upgrade.

- Do **not** hand-edit `packages/pg-delta/tests/integration/fixtures/supabase-base-init/*.sql`.
  Regenerate them with the maintainer script.
- Regenerate all supported fixtures:
  `cd packages/pg-delta && env -u PGDELTA_TEST_POSTGRES_VERSIONS bun run sync-base-images`
- Regenerate a single version while iterating:
  `cd packages/pg-delta && PGDELTA_TEST_POSTGRES_VERSIONS=17 bun run sync-base-images`
- The sync script is expected to:
  - create a temporary `supabase start` project pinned to the exact image tag
  - diff a bare `supabase/postgres` container against the fully bootstrapped
    local stack
  - write `tests/integration/fixtures/supabase-base-init/<major>_fullstack_container_init.sql`
  - replay that SQL into a fresh test-style Supabase container and require a
    final zero-diff validation
- `withDbSupabaseIsolated(...)` automatically replays the generated base-init
  fixture. Any test that starts `SupabasePostgreSqlContainer` manually must call
  `applySupabaseBaseInit(...)` from `packages/pg-delta/tests/utils.ts` before
  asserting on Supabase-managed objects or applying project migrations.
- After upgrading the image tags, rerun the focused regression tests before
  considering the upgrade done:
  - `cd packages/pg-delta && PGDELTA_TEST_POSTGRES_VERSIONS=15,17 bun run test tests/integration/supabase-base-init.test.ts tests/integration/catalog-model.test.ts tests/integration/supabase-dsl-e2e.test.ts`
  - `cd packages/pg-delta && PGDELTA_TEST_POSTGRES_VERSIONS=15 bun run test tests/integration/dbdev-roundtrip.test.ts`
- If the sync script or focused tests reveal new schemas, roles, grants, or
  comments, update pg-delta’s Supabase handling (for example
  `packages/pg-delta/src/core/integrations/supabase.ts` or the relevant
  extraction/diff/serialization logic) instead of papering over the problem by
  editing the generated SQL fixture by hand.

### Test Coverage Expectations

All code changes must be covered by tests:

- Unit tests go in `src/` next to the code (e.g., `src/core/objects/foo/foo.diff.test.ts`)
- Integration tests go in `tests/integration/` using `withDb`/`withDbIsolated` patterns
- **pg-delta:** Every fix or feat must be covered by at least one integration test that proves it works end-to-end (e.g. roundtrip or diff applied against a real DB).
- Prefer `roundtripFidelityTest` for pg-delta integration coverage instead of hand-rolled `createPlan` + apply assertions. Use custom plan assertions only when validating planner internals that roundtrip utilities cannot express.
- Follow existing test patterns in the codebase
- Author tests **before** the production change per **Test-Driven Fixes** above — a new test that has never failed does not prove the regression was real.

### Snapshot Assertions

Prefer `toMatchInlineSnapshot` over `toBe` or `toEqual` when asserting SQL output in integration tests. Inline snapshots make the expected SQL immediately visible in the test file, improving readability and making regressions obvious at a glance.

```typescript
expect(result.sql).toMatchInlineSnapshot(`
  "ALTER TABLE foo ADD COLUMN bar integer;"
`);
```

Start with an empty inline snapshot assertion, run the test once so Bun fills in the expected value automatically, and update snapshots intentionally with `bun run test -u -- "pattern"`.

### Kaizen (Continuous Improvement)

Whenever you are told you made a mistake — whether in commands, coding style, or guidelines — extract a generalizable lesson and propose a change to these agent guidelines so the same mistake does not happen again.

### Common Issues

- Lint errors can usually be detected and auto-fixed by running `bun run format-and-lint:fix && bun run check-types && bun run knip --fix`. Run this after you finish code changes to ensure you don't introduce lint errors into the project.
