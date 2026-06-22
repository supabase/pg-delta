---
"@supabase/pg-delta": patch
---

Stabilize materialized view definition extraction by deparsing with an isolated search path, preventing identical materialized views from being dropped and recreated when sessions have different `search_path` values.
