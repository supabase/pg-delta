---
"@supabase/pg-delta": patch
---

Declarative export now files `ALTER SEQUENCE … OWNED BY` with the owning table instead of the sequence file, so a file-atomic shadow load can create the sequence before `CREATE TABLE … nextval`.
