---
"@supabase/pg-delta": patch
---

`schema export` now round-trips databases with mutually-referencing foreign keys. A foreign key that participates in a cross-table reference CYCLE is written into a sibling `<table>.fk.sql` file (with an explanatory header) instead of the table's own file, so two tables that reference each other no longer land in two files that each fail to apply atomically. Acyclic foreign keys — the overwhelmingly common case — stay inline in their table's file for readability; the loader's bounded retry orders them. Applies to the `by-object` and `grouped` layouts (`ordered` was already correct), including the grouped layout's `--flat-schemas` / name-pattern regrouping, which preserves the `.fk.sql` split rather than folding cyclic FKs back into an atomic per-schema file; there is still no `foreign_keys/` directory. Round-trip fidelity (`load(export(db)) ≡ db`) is now covered for all three layouts.
