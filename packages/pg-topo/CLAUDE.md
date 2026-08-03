# CLAUDE.md -- @supabase/pg-topo

## What This Package Does

Topological sorting for SQL DDL statements. Parses SQL strings, extracts object dependencies, and returns a dependency-safe order for acyclic inputs. Cyclic results use a deterministic cycles-last fallback and require callers to handle `CYCLE_DETECTED` before direct execution. The core library is pure (no filesystem dependency).

## Commands

```bash
bun test                    # All tests (Docker required for validation)
bun run build               # Bundle with bun + emit declarations with tsc
bun run check-types         # Type check without emitting
bun run format-and-lint     # oxfmt + oxlint check
```

## Architecture

6-stage pipeline: Parse -> Classify -> Extract -> Build Graph -> Topo Sort -> Result

- `src/ingest/parse.ts` -- SQL content parsing (plpgsql-parser), no filesystem
- `src/classify/` -- Statement classification (40 types)
- `src/extract/` -- Dependency extraction from AST
- `src/graph/` -- Graph building and topological sort (Kahn's algorithm)
- `src/annotations/` -- SQL comment annotation parsing (`-- pg-topo:` directives)
- `src/model/` -- Core types and ObjectRef identity
- `src/from-files.ts` -- Filesystem adapter (discovery + read + delegates to core)
- `src/ingest/discover.ts` -- SQL file discovery (used only by from-files adapter)

## Test Patterns

Tests use `bun:test` with testcontainers for PostgreSQL runtime validation:
- `test/global-setup.ts` -- Preloaded to pull Docker images
- `test/support/postgres/postgres-container.ts` -- Container lifecycle using Bun's native SQL class
- Unit tests use inline SQL strings directly with `analyzeAndSort(sql: string[])`
- Integration tests use `analyzeAndSortFromFiles(roots)` or `analyzeAndSortFromRandomizedStatements` for filesystem fixtures

## Key API

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
