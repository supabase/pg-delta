---
"@supabase/pg-delta": patch
---

fix: a `statement_timeout` that fires on extraction's jit-disable round trip now surfaces as the typed `ExtractionTimeoutError` (with query label and budget) instead of the raw SQLSTATE 57014 pg error
