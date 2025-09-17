# Dependency ordering and function-in-defaults

## Summary

Ensure objects are created in dependency-safe order, especially when tables depend on functions in column defaults.

- Related migra issues:
  - [migra#92: Table with Function dependency causes error from function being created after table](https://github.com/djrobstep/migra/issues/92)

## Why it matters

If a table column default calls a function (e.g., `DEFAULT best_number()`), the function must exist before the table creation to avoid `ERROR: function ... does not exist`.

## Acceptance tests (e2e)

1) Function before table using it in DEFAULT

```sql
-- initialSetup (main empty)

-- testSql (branch)
CREATE OR REPLACE FUNCTION public.best_number() RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  RETURN 456;
END;$$;

CREATE TABLE public.test (
  best_id bigint NOT NULL DEFAULT public.best_number(),
  name text
);
```

Expected: Generated changes order puts `CREATE FUNCTION` before `CREATE TABLE` and applies cleanly.

2) Replace function used by default (no drop of table)

```sql
-- initialSetup (both DBs)
CREATE OR REPLACE FUNCTION public.best_number() RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE TABLE public.t (id bigint DEFAULT public.best_number());

-- testSql (branch)
CREATE OR REPLACE FUNCTION public.best_number() RETURNS bigint LANGUAGE sql AS $$ SELECT 2::bigint $$;
```

Expected: Diff replaces the function without forcing table recreation; ordering remains valid.

## pg-diff analysis (feature vs test)

- Status: Mostly covered; likely "to test / try out".
- Evidence:
  - `DEPENDENCIES.md` documents a dependency graph with topological sorting and special handling for sequences and selectables.
  - `src/dependency.ts` implements constraint generation and a topological sort; includes sequence/table inversion logic and per-object constraints.
  - `src/objects/procedure/**` extracts and creates functions using server definitions, which should integrate with dependency ordering.
- Action: Add integration tests mirroring the above acceptance cases to ensure function-before-table is enforced when defaults reference functions.


