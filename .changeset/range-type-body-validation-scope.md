---
"@supabase/pg-delta": patch
---

fix(pg-delta): scope shadow-load body validation to sql/plpgsql routines

`loadSqlFiles`'s post-load body-validation pass re-ran every non-extension-member routine's definition with `check_function_bodies = on`, regardless of language. `check_function_bodies` only validates `sql`/`plpgsql` bodies — Postgres never checks other languages — so re-running an `internal`/`c` routine added no coverage and could break the load outright: `CREATE TYPE ... AS RANGE (...)` auto-creates `LANGUAGE internal` constructor/support functions, and re-running those as a non-superuser role (the production-faithful Supabase case) fails with `permission denied for language internal`. The validation query now filters to `sql`/`plpgsql` routines.
