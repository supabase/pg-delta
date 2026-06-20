---
"@supabase/postgrest-typegen": minor
---

Drop the unused per-table `relationships` and `primary_keys` fields from `PostgresTable` / `GeneratorMetadata.tables[]`, and remove the corresponding `pg_constraint` JSON-array join and primary-key subquery from the tables introspection SQL.

None of the language generators ever read these per-table fields — TypeScript relationship output is built from the top-level `GeneratorMetadata.relationships` (the PostgREST-shaped `PostgresRelationship`), and Go/Python/Swift emit no relationship metadata at all. Removing them makes `introspect()`'s tables query markedly cheaper (the expensive constraint join is gone) without changing any generator output (byte-parity preserved). The `PostgresRelationshipOld` and `PostgresPrimaryKey` types are removed accordingly.

This trims the `GeneratorMetadata` contract; consumers that produce metadata through a custom adapter no longer need to populate those table fields. postgres-meta's `/tables` REST endpoint is unaffected — it uses its own table types, not this package's.
