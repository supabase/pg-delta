---
"@supabase/pg-delta": minor
---

Compaction now folds validated PRIMARY KEY / UNIQUE / CHECK constraints on co-created tables into the `CREATE TABLE` parens (`CONSTRAINT name <def>`) in regular diff plans, not just `schema export`. These constraint types are self-contained (they never reference another relation's rows), and the fold runs under the strict no-crossing-edge veto, so apply-executor ordering is unaffected. FOREIGN KEY and exclusion constraints keep their separate `ALTER TABLE … ADD CONSTRAINT` statements.
