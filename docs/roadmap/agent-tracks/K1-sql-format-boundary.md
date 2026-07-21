# K1 — sql-format boundary (**retired — folded into D0**)

**Status:** Retired 2026-07-20. Do not delegate.

## Why retired

Fact-check against the package showed the boundary **already exists**:

- `packages/pg-delta/package.json:78-83` exports `./sql-format` (and
  `./extract`, `./plan`, `./apply`, `./proof`, `./core`, `./policy`, …) as
  subpaths.
- The root package (`src/index.ts`) re-exports no sql-format **symbols** —
  though it does load the formatter transitively via `exportSqlFiles`
  (`index.ts:70-72` → `export-sql-files.ts:22`); only focused subpaths
  (`/core`, `/plan`, …) avoid it. D0 owns stating this precisely.

Tier B (package/subpath boundary) is therefore done, and Tier A (docs wording:
“engine LOC excludes sql-format”, import guidance for embedders) is a
paragraph, not a track. That paragraph is now **owned by
[D0](D0-docs-metrics.md)** as part of its three-budget split (engine slice /
product surface / package total).

If a physical package split (`@supabase/pg-delta-sql-format`) is ever wanted,
that is a product/publishing decision — open a fresh issue with the use case;
this brief does not cover it.
