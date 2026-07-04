---
"@supabase/pg-delta-next": patch
---

Fix `--format` stranding the ALTER action keyword after a double-quoted object
name. The catalog renderer always double-quotes names and `scanTokens` drops
quoted identifiers, so positional token indexing in `formatAlterTable` and
`formatAlterGeneric` landed on the action keyword and split the header there
(e.g. `ALTER TABLE "public"."users" ADD` / `  COLUMN ...`). Both formatters now
locate the name's true end from the raw statement via `qualifiedNameEnd`,
matching how the CREATE-family formatters already handle quoted names.
