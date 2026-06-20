---
"@supabase/postgrest-typegen": patch
---

Restore deterministic table ordering in `introspect()`. `TABLES_SQL` now sorts by `c.oid`, matching the order postgres-meta's original query produced via its `GROUP BY` aggregate plan. Dropping the per-table relationships aggregation earlier also removed that `GROUP BY`, leaving the tables query with no explicit ordering — so rows came back in heap-scan order, which varies by environment. The TypeScript generator sorts objects alphabetically and was unaffected, but the Go/Python/Swift generators emit in metadata order, so their output (and postgres-meta's order-sensitive snapshots) could differ depending on the database. Generator content is unchanged; only the (now deterministic) ordering is pinned.
