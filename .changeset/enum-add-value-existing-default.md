---
"@supabase/pg-delta": patch
---

fix(pg-delta): order an in-place ALTER of a dependent after the in-place ALTER of what it depends on. Adding an enum value and pointing an existing column's default at it in the same plan previously emitted `ALTER TABLE … SET DEFAULT 'c'::st` before `ALTER TYPE st ADD VALUE 'c'`, so apply failed with 22P02 (invalid input value for enum).
