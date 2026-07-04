---
"@supabase/pg-delta-next": minor
---

Add opt-in SQL pretty-printing to declarative export. `schema export --format-options '{"keywordCase":"upper","maxWidth":180}'` runs each exported file's SQL through a formatter before writing; it is off by default (output is the renderer's raw SQL), works with any layout (`by-object`/`ordered`/`grouped`), and is cosmetic — the `load(export(fb)) ≡ fb` fidelity gate still holds. The formatter is also exposed as a dependency-free library helper at the new `@supabase/pg-delta-next/sql-format` subpath (`formatSqlStatements(statements, options)`), so callers can format SQL independently. It is a self-contained token-based formatter ported from the old engine (no SQL parser, no new runtime dependencies).
