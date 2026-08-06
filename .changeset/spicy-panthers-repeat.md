---
"@supabase/pg-delta": minor
---

Add a `partitionOf` predicate to the Policy DSL: matches declarative partition
children (`pg_class.relispartition`), optionally pinned to a parent table by
schema/name glob. `{ partitionOf: {} }` is the drop-in replacement for the old
filter DSL's `table/is_partition: true`; the pinned form
(`{ partitionOf: { schema: "realtime", name: "messages" } }`) is preferred —
it states whose partitions are operational churn instead of hiding every
partition, and the projection audit classifies it as a named-object selector.
