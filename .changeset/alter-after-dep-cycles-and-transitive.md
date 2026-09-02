---
"@supabase/pg-delta": patch
---

fix(pg-delta): walk through unchanged dependencies when ordering in-place ALTERs, and skip an alter-after-dep edge that would close an action-graph cycle. A column default over an unchanged domain now waits for the underlying enum ADD VALUE; a 3-domain default ring and a domain-default + new-column + OWNED BY sandwich stay sortable.
