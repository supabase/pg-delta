---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): order tables/functions after array-of-composite element types

The `pg_depend` resolver mapped type endpoints only for domain/enum/composite/range
types, silently dropping edges to ARRAY types. A column or argument of type `foo[]`
records its dependency against the implicit array type `_foo`, so the table/function
was not ordered after the composite/domain/enum element type: apply failed with
`type "…[]" does not exist` (create direction) or `cannot drop type … because other
objects depend on it` (teardown direction). Array-type endpoints now resolve to their
element type's stable id. Surfaced by the Supabase realtime schema
(`realtime.subscription.filters realtime.user_defined_filter[]`).
