---
"@supabase/pg-delta": patch
---

`schema export` now round-trips databases with mutually-referencing foreign keys. Foreign-key constraints are written into a sibling `<table>.fk.sql` file instead of the table's own file, so two tables that reference each other no longer land in two files that each fail to apply atomically. Applies to the `by-object` and `grouped` layouts (`ordered` was already correct), including the grouped layout's `--flat-schemas` / name-pattern regrouping, which preserves the `.fk.sql` split rather than folding FKs back into the per-schema category file; there is still no `foreign_keys/` directory. Round-trip fidelity (`load(export(db)) ≡ db`) is now covered for all three layouts.
