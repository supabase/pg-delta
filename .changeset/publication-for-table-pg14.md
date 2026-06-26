---
"@supabase/pg-delta-next": patch
---

Emit a single `TABLE` keyword in the inlined `CREATE PUBLICATION … FOR TABLE`
clause (`FOR TABLE a, b`) instead of repeating it per relation
(`FOR TABLE a, TABLE b`). The repeated-keyword form is only valid grammar on
PostgreSQL 15+; on PG14 it is a syntax error. The collapsed form is valid on
every supported version (PG14 never has schema members), and schema members
are likewise grouped under a single `TABLES IN SCHEMA`.
