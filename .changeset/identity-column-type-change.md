---
"@supabase/pg-delta": patch
---

Fix unappliable plans when an identity or generated column changes type (e.g.
widening `integer GENERATED ALWAYS AS IDENTITY` to `bigint`). The leading
`ALTER COLUMN … DROP DEFAULT` is now skipped for such columns (PostgreSQL
rejects it outright), and the `USING` cast is dropped for generated columns
(also rejected).

The `DROP DEFAULT` gate reads the *desired* identity state, not the source one:
identity add/drop deltas order before the type change, so a plain column that
gains identity in the same plan is already an identity column by then and the
`DROP DEFAULT` was rejected.

An identity column's sequence bounds are also positioned relative to the `TYPE`
change by direction. Widening emits them *after* it (the desired bounds need not
fit the old type). Narrowing emits them *before* it, because an explicit bound
that overflows the new type made the retype itself fail (`MAXVALUE (5000000000)
is out of range for sequence data type integer`).
