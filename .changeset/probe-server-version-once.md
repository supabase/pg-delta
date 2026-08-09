---
"@supabase/pg-delta": patch
---

perf: probe the server version once per extraction instead of five times, trimming redundant round trips.
