---
"@supabase/pg-delta": patch
---

The SQL formatter now wraps long `GRANT`/`REVOKE` statements at clause boundaries (privileges, `ON <target>`, `TO`/`FROM <grantees>`) instead of the generic first-comma wrap that put one privilege per line. Short statements keep their single line.
