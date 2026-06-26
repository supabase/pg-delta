---
"@supabase/pg-topo": patch
---

fix(pg-topo): break inline foreign-key cycles instead of silently dropping statements

A mutual foreign-key reference between two tables (or any FK loop spanning
several tables) is a real dependency cycle: neither table can be created with
its FK declared inline. Previously the topological sort dropped the cycle
participants — and every statement depending on them — from the `ordered`
result, leaving only a `CYCLE_DETECTED` diagnostic. Declarative apply then
built an incomplete schema from the truncated list, which surfaced downstream
as spurious `DROP` statements for objects that still existed
(supabase/pg-toolbelt#311).

`analyzeAndSort` now mirrors `pg_dump`: when a cycle is detected it strips the
cross-cycle FK constraints from the offending `CREATE TABLE` statements and
re-emits them as standalone `ALTER TABLE ... ADD CONSTRAINT` statements,
preserving the constraint name, columns, and `ON DELETE`/`ON UPDATE` actions.
Self-referential FKs are kept inline. As a safety net, any statement still
left in an unbreakable cycle is appended to `ordered` in deterministic order
rather than being dropped, so consumers always receive every statement.
