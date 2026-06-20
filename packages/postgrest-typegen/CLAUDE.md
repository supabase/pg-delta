# CLAUDE.md -- @supabase/postgrest-typegen

## What This Package Does

Type generation for PostgREST from a PostgreSQL schema. Introspects a database
into a normalized `GeneratorMetadata` shape, then renders language types
(TypeScript, Go, Python, Swift) from it. This is the engine extracted from
postgres-meta (the one behind `supabase gen types`), repackaged as a small,
driver-agnostic library.

## Architecture

Hard split between **introspection** and **generation**:

- `src/introspection/` -- `introspect(db, opts) => GeneratorMetadata`. Takes a
  structural `Queryable` (`pg.Pool`/`pg.Client` satisfy it; postgres-meta
  injects its forked-pg pool). Runs SQL builders ported from postgres-meta.
- `src/generation/` -- `generateTypescript` / `generateGo` / `generatePython` /
  `generateSwift`. Pure functions: `GeneratorMetadata` in, source string out.
  No database access.
- `src/types.ts` -- `GeneratorMetadata` + `Postgres*` types. This is the public,
  pluggable contract: any source that can produce `GeneratorMetadata` can feed
  the generators. **ArkType is the single source of truth here**: each shape is
  an ArkType schema and the exported type is `typeof schema.infer`. The arrays
  on `GeneratorMetadata` use `.omit("columns")` to mirror `Omit<…, "columns">`.
  A compile-time equivalence test (`test/validation/validate.test.ts`) pins the
  inferred types to the frozen interface contract so they can't silently drift.
  `parseGeneratorMetadata(data)` is an **opt-in** runtime validator (throws on
  mismatch) — it is intentionally NOT called inside `introspect()`; integrators
  with a custom producer wrap the result themselves.

## Subpath Exports

- `.` -- everything
- `./introspection` -- `introspect`, `Queryable`
- `./generation` -- the `generateX` functions

The `bun` condition serves TypeScript source directly; `import`/`require` serve
compiled JS from `dist/`.

## Commands

```bash
bun run build           # tsc --project tsconfig.build.json (emits dist/)
bun run check-types     # tsc --noEmit
bun run test            # bun:test (Docker required for integration/parity tests)
bun run format-and-lint # oxfmt + oxlint check
bun run knip            # unused-code/deps check
```

## Byte-Parity Constraint

This package must produce **byte-identical** output to postgres-meta's
templates until parity is validated and released. Two consequences:

- `prettier` is pinned **exact** to `3.5.3` (the version postgres-meta's
  lockfile resolves). Do not bump it during the port.
- Don't "improve" template strings or SQL during the port. Byte parity first;
  behavior-changing cleanups (e.g. oxfmt instead of prettier) come later.

`int8` columns: stock `pg` returns them as strings while postgres-meta installs
a global int8 type parser. `src/introspection/normalize.ts` coerces known
numeric id fields after each query so output is identical under any driver.

## Test Patterns

- Generation unit tests: pure, no Docker, fixture-builder + per-language inline
  snapshots (`src/` and `test/generation/`).
- Introspection/parity tests: `bun:test` + testcontainers PostgreSQL.
