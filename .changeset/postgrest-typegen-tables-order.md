---
"@supabase/postgrest-typegen": minor
---

Add `sortGeneratorMetadata`, a generator-agnostic pass that deterministically orders every `GeneratorMetadata` collection (tables/views/etc. by oid, columns by `table_id` + ordinal position, relationships by a stable key). The Go/Python/Swift generators emit objects in metadata order, so their output was sensitive to however the producer ordered its rows — the SQL introspector returns rows in heap order, which varies by environment (a regression surfaced after the relationships-aggregation removal dropped `TABLES_SQL`'s incidental `GROUP BY` ordering). Rather than pin ordering in SQL, callers now apply `sortGeneratorMetadata` after introspection and before generation; the generators document that they expect pre-sorted input. Generator content is unchanged — only ordering is now canonical and deterministic regardless of the metadata producer.
