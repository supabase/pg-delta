---
"@supabase/pg-delta": patch
---

Order enum value additions so `BEFORE` and `AFTER` anchors always reference labels that already exist when the statement runs.
