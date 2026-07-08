---
"@supabase/pg-delta": patch
---

`schema export` now round-trips databases with mutually-referencing foreign keys. Foreign-key constraints are written into a sibling `<table>.fk.sql` file instead of the table's own file, so two tables that reference each other no longer land in two files that each fail to apply atomically. Applies to the `by-object` and `grouped` layouts (`ordered` was already correct); there is still no `foreign_keys/` directory. Round-trip fidelity (`load(export(db)) ≡ db`) is now covered for all three layouts.
