---
"@supabase/pg-delta": minor
---

Refuse a PostGIS schema relocation instead of planning `DROP EXTENSION postgis`.

PostGIS is non-relocatable (`extrelocatable = false`). When source and desired
disagree on its schema, the generic rule would replace it — `DROP EXTENSION`
cascades over every geometry/geography column and `spatial_ref_sys`. The plan
now fails with an actionable error naming both schemas and asking the
declaration to match the installed location. An explicit `DROP EXTENSION
postgis` (extension absent on the desired side) is unchanged.
