---
"@supabase/pg-delta": patch
---

The `concurrentIndexes` serialize option no longer inserts `CONCURRENTLY` for
indexes on partitioned tables. PostgreSQL rejects `CREATE INDEX CONCURRENTLY`
on a partitioned table's parent index (relkind `p`), so such a plan failed at
apply time. Those indexes are now created plainly (transactionally) while
indexes on regular tables keep the concurrent, non-transactional path.
