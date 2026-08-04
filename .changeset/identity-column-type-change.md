---
"@supabase/pg-delta": patch
---

Fix unappliable plans when an identity or generated column changes type (e.g.
widening `integer GENERATED ALWAYS AS IDENTITY` to `bigint`). The leading
`ALTER COLUMN … DROP DEFAULT` is now skipped for such columns (PostgreSQL
rejects it outright), the `USING` cast is dropped for generated columns (also
rejected), and an identity column's sequence bounds are now emitted *after* the
`TYPE` change instead of before it, where `SET MAXVALUE` was out of range for
the not-yet-retyped sequence.
