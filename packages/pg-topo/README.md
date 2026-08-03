# pg-topo

_deterministic dependency sorting for declarative PostgreSQL schemas_

For acyclic inputs, `pg-topo` sorts declarative PostgreSQL schema statements
into a deterministic, dependency-safe execution order. When cycles remain, it
returns a deterministic cycles-last fallback; callers must handle
`CYCLE_DETECTED` before executing the result directly.

It is designed for SQL-first projects where schema lives in many `.sql` files and statement order is not guaranteed.

## Why

In declarative schema repos, statements are often split by concern (tables, functions, policies, grants, etc.).  
Execution order then becomes fragile:

- function created before a referenced function
- view created before a base table
- FK/constraint/index ordering issues
- policy/trigger statements applied before targets exist

`pg-topo` performs static analysis over SQL ASTs, builds a dependency graph, and returns the sorted order plus diagnostics.

## Role: an advisory dev-layer assist

`pg-topo` is **advisory** static analysis, never a trusted source of truth. Its
`ObjectRef` identity is approximate and it cannot resolve fundamentally
runtime-only cases, so consumers must treat its order and diagnostics as a
best-effort aid, not a guarantee.

Its primary consumer is [`@supabase/pg-delta`](../pg-delta), which uses
it as the **statement reordering assist for shadow loading**: it splits and
pre-sorts declarative SQL files so an ephemeral shadow database converges in
fewer rounds, while Postgres remains the actual elaborator
([target-architecture §4.4.1](../../docs/architecture/target-architecture.md)).
pg-delta declares pg-topo an _optional peer dependency_ and loads it through
a guarded dynamic `import()`, so the assist degrades cleanly when pg-topo is
absent — it can only fail to _build_ the shadow (a visible error), never corrupt
the extracted schema.

## Current Scope

- Pure library API (no CLI yet, no filesystem dependency in core)
- Static analysis only in publishable library code
- Deterministic output for the same input set
- Runtime validation is test-support code in this repository (not part of public API)

## Installation

When published:

```bash
bun add @supabase/pg-topo
```

For local development in this repo:

```bash
bun install
```

## Quick Start

The core API accepts a list of SQL content strings (each string can contain multiple statements):

```ts
import { analyzeAndSort } from "@supabase/pg-topo";

const result = await analyzeAndSort([
  "create schema app;",
  "create table app.users(id int primary key, email text not null);",
  "create view app.user_emails as select email from app.users;",
]);

if (result.diagnostics.length > 0) {
  for (const diagnostic of result.diagnostics) {
    console.log(`[${diagnostic.code}] ${diagnostic.message}`);
  }
}

const sortedSql = result.ordered.map((statement) => statement.sql).join("\n\n");
console.log(sortedSql);
```

## Using with Files

If you want to point at directories or `.sql` files on disk, use the filesystem adapter:

```ts
import { analyzeAndSortFromFiles } from "@supabase/pg-topo";

const result = await analyzeAndSortFromFiles(["./schema"]);
```

`analyzeAndSortFromFiles` discovers `.sql` files, reads them, and delegates to the core `analyzeAndSort`. This is the only part of the package that uses Node `fs`.

## Public API

### `analyzeAndSort(sql: string[]): Promise<AnalyzeResult>`

Pure library function. Accepts an array of SQL content strings. Each string is
parsed atomically: if any SQL in one string is invalid, that entry contributes
no statements and emits `PARSE_ERROR`. Separate array entries are parsed
independently. No filesystem access.

### `analyzeAndSortFromFiles(roots: string[]): Promise<AnalyzeResult>`

Filesystem adapter. Accepts file paths and/or directory paths. Discovers `.sql` files, reads them, and calls `analyzeAndSort` internally.

### `AnalyzeResult`

```ts
type AnalyzeResult = {
  ordered: StatementNode[];
  diagnostics: Diagnostic[];
  graph: GraphReport;
};
```

Additional exported types:

- `AnnotationHints`
- `DiagnosticCode`
- `GraphEdge`
- `GraphEdgeReason`
- `ObjectKind`
- `ObjectRef`
- `PhaseTag`
- `StatementId`

### `ordered`

`ordered` is the deterministically ordered statement list.
Each item includes:

- original `sql`
- `statementClass`
- `phase`
- extracted `provides` / `requires`
- stable `id` (`filePath`, `statementIndex`)

For the core `analyzeAndSort`, `filePath` uses synthetic source labels (e.g. `<input:0>`, `<input:1>`).  
For `analyzeAndSortFromFiles`, `filePath` is the relative path to the source `.sql` file.

`ordered` is a **total order**: it always contains every successfully parsed
statement exactly once. It begins with the maximal acyclic prefix that can be
topologically drained. The residual cycle components and any descendants they
block follow in condensation-DAG order. Tie-breaks between ready components and
the order within each cycle are deterministic; the order within a cycle is not
a topological order. Cycles are still reported through `CYCLE_DETECTED` and
`graph.cycleGroups`.

### `diagnostics`

Static diagnostics emitted by the library:

- `PARSE_ERROR`
- `DISCOVERY_ERROR`
- `UNKNOWN_STATEMENT_CLASS`
- `UNRESOLVED_DEPENDENCY`
- `DUPLICATE_PRODUCER`
- `CYCLE_DETECTED`
- `INVALID_ANNOTATION`

### `graph`

Graph metadata includes:

- `nodeCount`
- `edges` (`from`, `to`, `reason`, optional `objectRef`)
- `cycleGroups`

## Input Discovery Rules (filesystem adapter only)

Given `roots`, `analyzeAndSortFromFiles`:

- accepts `.sql` files directly
- recursively scans directories for `.sql` files
- sorts discovered files deterministically
- emits `DISCOVERY_ERROR` for missing roots

## Deterministic Ordering

Ordering combines:

1. dependency graph edges (`requires` -> `provides`)
2. phase ordering (`bootstrap`, `pre_data`, `data_structures`, `routines`, `post_data`, `privileges`)
3. statement-class priority tie-breaks (pg_dump-inspired)
4. stable source tie-breakers (source label + statement index)

## Annotations

You can provide explicit hints with leading SQL comments:

```sql
-- pg-topo:phase routines
-- pg-topo:depends_on app.users
-- pg-topo:requires function:app.normalize(jsonb)
-- pg-topo:provides view:app.user_ids
create view app.user_ids as
select id from app.users;
```

Supported directives:

- `phase`
- `depends_on`
- `requires`
- `provides`

Notes:

- only _leading_ comment lines are parsed as annotations
- invalid or conflicting annotations produce `INVALID_ANNOTATION` diagnostics
- annotation directive prefix is `pg-topo:`

## What It Does Not Do

- It does not execute SQL as part of library API.
- It does not infer every extension-provided object statically.
- It does not solve fundamentally ambiguous runtime-only cases (for example deeply dynamic SQL).

## Quality Checks and Tests

```bash
bun run --parallel "*:check"
bun run --parallel "*:fix"
bun run test
```

Individual scripts from `package.json`:

- `test`
- `types:check`
- `lint:check`
- `lint:fix`
- `fmt:check`
- `fmt:fix`
- `knip:check`
- `knip:fix`

This repo includes test-support runtime validation against live PostgreSQL containers (Testcontainers) to verify sorted output execution in integration fixtures.
