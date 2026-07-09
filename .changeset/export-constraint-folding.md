---
"@supabase/pg-delta": minor
---

`schema export` now folds validated table constraints **inline into their `CREATE TABLE`** — `CONSTRAINT name PRIMARY KEY (…)`, `CONSTRAINT name FOREIGN KEY (…) REFERENCES …`, `CHECK`, `UNIQUE`, `EXCLUDE` render inside the column parens (names and options preserved verbatim from `pg_get_constraintdef`), so an exported table reads like hand-written SQL instead of a `CREATE TABLE` followed by a trail of `ALTER TABLE … ADD CONSTRAINT`. `NOT VALID` constraints stay as `ALTER`s (an inline constraint always validates), and cycle-participating foreign keys keep the `.fk.sql` split. Export-only via the new `PlanOptions.foldConstraints`: export files are consumed by the retry/reorder loader (where a folded FK referencing a later file is safe); regular diff plans are byte-identical to before (corpus-verified).
