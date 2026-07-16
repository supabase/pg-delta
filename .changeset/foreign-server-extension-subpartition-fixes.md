---
"@supabase/pg-delta": patch
---

Fix five round-trip fidelity gaps in the planner:

- Multi-level partitions keep their own `PARTITION BY` clause, so a partition that is itself partitioned can have sub-partitions attached.
- Removing a foreign server `VERSION` (which has no `ALTER SERVER` grammar) now routes to a drop + recreate instead of crashing planning.
- `ALTER EXTENSION … SET SCHEMA` is no longer emitted for non-relocatable extensions; relocation is planned as a drop + recreate in the new schema.
- Zero-argument aggregate `COMMENT` / `SECURITY LABEL` targets render `name(*)` instead of the invalid `name()`.
- Replacing a foreign server that has dependent foreign tables / user mappings now drops and recreates those children around the replace (the parent `DROP SERVER` does not cascade), instead of failing on the surviving dependents.
