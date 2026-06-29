---
"@supabase/pg-delta-next": patch
---

Fix planning / export from empty for a domain that carries a `NOT VALID` CHECK constraint. The constraint definition was spliced inline into `CREATE DOMAIN`, but PostgreSQL only accepts `NOT VALID` on `ALTER DOMAIN … ADD CONSTRAINT`, so the emitted SQL failed with `syntax error at or near "VALID"`. Unvalidated domain constraints are now left out of the inline `CREATE DOMAIN` and emitted as a standalone `ALTER DOMAIN … ADD CONSTRAINT … NOT VALID` action instead.
