---
"@supabase/pg-delta": patch
---

Recognize dump-style quoted `CREATE EXTENSION "supabase_vault"` in the raw-profile shadow precheck, and treat a `depends` edge onto the extension itself as vault-in-use (extract folds vault proc/type members to the extension id).
