---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): route schema-scoped ALTER DEFAULT PRIVILEGES out of cluster/roles.sql and preserve matview USING/TABLESPACE

- A schema-scoped `ALTER DEFAULT PRIVILEGES ... IN SCHEMA` was exported into the
  atomic `cluster/roles.sql` file alongside `CREATE ROLE`. Because `schema apply`
  disables statement reordering whenever an ADP is present, the raw file-granular
  loader ran that file as a single transaction, the ADP failed on the
  not-yet-created schema, and `CREATE ROLE` rolled back with it — the export could
  never reload. It is now filed under `schemas/<schema>/default_privileges.sql`,
  where the loader's defer-and-retry converges. Global (schema-null) ADPs still
  stay with the roles.
- The materialized-view formatter dropped the `USING <access method>` and
  `TABLESPACE <name>` clauses that precede `AS` because they were not in the
  matview clause-keyword set. Both are now preserved.
