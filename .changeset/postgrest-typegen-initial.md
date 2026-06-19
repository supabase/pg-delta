---
"@supabase/postgrest-typegen": minor
---

Initial alpha of `@supabase/postgrest-typegen`: type generation for PostgREST extracted from postgres-meta. Provides a hard split between introspection (`introspect(db)` → `GeneratorMetadata`) and pure generation (`generateTypescript`/`generateGo`/`generatePython`/`generateSwift`), with `GeneratorMetadata` as the pluggable contract. Output is byte-identical to postgres-meta's embedded templates.
