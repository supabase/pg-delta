---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): don't drop standalone unique indexes referenced by a foreign key

Index extraction excluded any index whose oid appears in some constraint's `conindid`,
intending to skip indexes owned by a PRIMARY KEY / UNIQUE / EXCLUSION constraint (those
are serialized via the constraint). But a FOREIGN KEY constraint also sets `conindid` —
to the index on the REFERENCED table it depends on — so a standalone `CREATE UNIQUE
INDEX` disappeared from extraction the moment any FK referenced it. The plan then never
created the index, and the FK failed to apply with `there is no unique constraint
matching given keys for referenced table …`. Extraction now excludes only indexes owned
by a `p`/`u`/`x` constraint. Surfaced by the Supabase realtime schema (`_realtime.tenants`
unique index on `external_id`, referenced by an FK from `_realtime.extensions`).
