---
"@supabase/pg-delta": patch
---

Role-rename carry now preserves the `column` field (and all other id fields) when relabeling ACL ids, so a pure role rename involving a COLUMN-level grant (`GRANT SELECT (col) ON t TO r`) no longer emits a spurious REVOKE/GRANT pair around the rename. PostgreSQL carries the column grant across the rename by OID; the planner no longer re-issues DDL that would also require table-grant privileges a rename-only migration should not need.
