---
"@supabase/pg-delta": patch
---

Make in-place `ALTER` actions participate in the plan's dependency walk by declaring `consumes`/`releases` on four rule sites, so they no longer sort before the `CREATE` of a new dependency or after the `DROP` of an old one. Column `TYPE …` changes now consume the new column type and release the old one; `ALTER EXTENSION … SET SCHEMA` releases the old schema; sequence `OWNED BY` reassignment releases the old owning column; and `ALTER POLICY … TO` consumes newly-listed roles and releases removed roles. Previously each of these could be emitted against a not-yet-created target ("type/relation/policy does not exist") or block a same-plan `DROP` of the object it stopped referencing.
