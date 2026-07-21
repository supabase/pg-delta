---
"@supabase/pg-delta": minor
---

Enum value-set rebuilds now pick a namespace- and length-safe temp name for the old enum: the collision check consults every occupant of the type namespace (enums/composites/ranges, domains, and the implicit row types of tables/views/matviews/foreign tables/sequences), and the generated identifier is clipped to ≤ 63 bytes so PostgreSQL never truncates it back onto an occupied name.

Table `CREATE`s and schema exports now render columns in DECLARED order instead of alphabetical name order. Column position (`pg_attribute.attnum`) is captured at extract time as a non-semantic field, so a from-empty create/export reproduces the original `SELECT *`, positional-INSERT, and row-type layout; order-only differences on an existing table remain undiffed by design (the field is excluded from the fact hash and diff).
