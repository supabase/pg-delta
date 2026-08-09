---
"@supabase/pg-delta": patch
---

Fix a false-positive `unmodeled_kind` warning for the range→multirange cast that `CREATE TYPE ... AS RANGE` auto-creates. Unmodeled-kind detection now excludes objects registered as `pg_depend`-internal (`deptype = 'i'`) to another object, since such objects are created and dropped alongside their owner and can never be independently managed DDL — the owner's own fact already covers their lifecycle. Explicit user-authored objects (e.g. a hand-written `CREATE CAST`) are unaffected and still warn.
