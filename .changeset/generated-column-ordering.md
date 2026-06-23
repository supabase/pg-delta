---
"@supabase/pg-delta-next": patch
---

Fix generated-column ordering and compaction so the dbdev core schema roundtrips
under the Supabase profile. Stored generated columns are no longer folded into a
bare `CREATE TABLE` (the inlined `GENERATED ALWAYS AS (…)` clause would reference
columns that do not exist yet); they stay as a trailing `ADD COLUMN`. Their build
order is now driven from `pg_depend`: attrdef dependencies are shadowed onto the
owning column, so a column with a default or generated expression is ordered after
the objects it references (e.g. `nextval(...)` sequences, base columns, and
functions used in the generation expression). Also resolves relation-tied
composite types (`pg_type.typrelid`, e.g. `SETOF <table>`) to their table/view
fact so dependents order correctly.
