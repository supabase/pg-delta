---
"@supabase/pg-delta": patch
---

Plans (and therefore rendered migration files) only carry
`check_function_bodies = off` in their session preamble when the plan actually
touches a routine-family object — a function, procedure, aggregate, extension,
or extension intent, directly or through a satellite (comment / grant /
security label) or a reference (e.g. a trigger's function). A migration that
only touches tables, columns, indexes, or grants no longer starts with a
`set local check_function_bodies = off;` it cannot need.

The predicate deliberately errs toward keeping the entry, and the omission is
part of the cosmetic compaction contract: planning with `compact: false`
restores the unconditional preamble.
