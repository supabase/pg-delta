---
"@supabase/pg-delta": patch
---

fix(pg-delta): preserve the event/table clause when formatting triggers with quoted names

A trigger whose name must be double-quoted (e.g. it contains a dash, like a Supabase webhook named `send-chat-push`) had its generated DDL mangled: the SQL formatter dropped the `AFTER INSERT ON <table>` event/table clause, producing invalid migration SQL. The tokenizer skipped double-quoted identifiers entirely, so the trigger formatter mistook the next keyword for the trigger name and sliced away everything before the first recognized clause. The tokenizer now emits an atomic token for double-quoted identifiers, which also fixes the same latent issue for other object types whose names follow a keyword positionally (subscriptions, servers, foreign data wrappers, etc.).
