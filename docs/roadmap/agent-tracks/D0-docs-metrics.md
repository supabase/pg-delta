# D0 — Fix size / corpus narrative

**Priority:** High (trust tax) · **Wave:** 0 · **Ship:** alone · **Parallel with:** anything

> **Contract:** re-measured three-budget size story (engine slice / product
> surface / package total), dated; precise sql-format boundary wording
> (subpaths avoid it; root loads it transitively).

## Goal

Stop marketing an obsolete size story. Reviewers and agents currently optimize
against `docs/overview.md` claiming ~11.5k LOC / 46 files / 210 scenarios while
the package is ~27k non-test LOC / ~107 source files / ~316+ corpus scenarios
(**re-measure at PR time** — do not copy these figures blindly; `ls corpus | wc -l`
was 316 on 2026-07-20).

## Why this track exists

Architecture reviews repeatedly flag docs drift as a maintainability risk: it
mis-sets expectations for “lean core,” understates frontends growth, and makes
P2’s “two forms of knowledge” read as a package-wide claim rather than a
diff-path claim.

## Out of scope

- No production code changes.
- Do not rewrite architecture north-star docs for identity/compaction (those are
  I2 / C1).
- Do not move packages or split sql-format (K1).

## Owned files (write)

- `docs/overview.md` (primary)
- `docs/roadmap/v1.md` (corpus counts)
- `docs/build-log.md` only if it still asserts the same stale numbers
- This folder’s README metrics if you refresh measured numbers in the intro

## Read-only references

- Measure with:
  ```bash
  find packages/pg-delta/src -name '*.ts' ! -name '*.test.ts' -type f | xargs wc -l
  # per-dir: core extract plan proof policy integrations frontends apply cli
  ls packages/pg-delta/corpus | wc -l
  ```
- `docs/architecture/target-architecture.md` (for accurate “two forms” wording —
  clarify that generic diff is kind-free; planner/rules remain per-kind)

## Acceptance criteria

1. Overview TL;DR and status lines use **current measured** LOC, file count, and
   corpus scenario count (date the measurement in a footnote or parenthetical).
2. Distinguish at least three budgets:
   - **Engine slice** — `core + extract + plan + proof + apply + policy + integrations`
   - **Product surface** — `frontends + cli`
   - **Published package total** — all non-test `src/`

   Include the sql-format wording absorbed from retired
   [K1](K1-sql-format-boundary.md): state that “engine LOC” excludes
   `frontends/sql-format` (~3.8k). Be precise about the boundary:
   `./sql-format` is a package subpath export (`package.json:78-83`) and the
   root index re-exports no sql-format **symbols** — but the root **does**
   transitively load the formatter (`index.ts:70-72` exports `exportSqlFiles`,
   which imports `formatSqlStatements`, `export-sql-files.ts:22`). Only
   focused-subpath consumers (`/core`, `/plan`, …) reliably avoid loading it.
   Do not claim root consumers “never load the formatter.”
3. Where “79% smaller / ~11.5k” appears as historical rewrite result, either:
   - keep it clearly labeled as **rewrite-era snapshot**, or
   - replace with current numbers and move the historical claim to build-log.
4. `v1.md` corpus count matches `packages/pg-delta/corpus` (scenarios, and
   “×2 directions” if still claimed).
5. Do not claim “PostgreSQL knowledge lives only in two forms” for the whole
   package without noting rule table + planner phases.

## Test plan

- None (docs only). Spot-check links still resolve.
- Optional: `rg '11,?500|~11\\.5k|210 scenarios|46 files' docs`

## Changeset

- Not required (docs-only).

## Done when

PR updates the stale metrics; index in `agent-tracks/README.md` still accurate.
