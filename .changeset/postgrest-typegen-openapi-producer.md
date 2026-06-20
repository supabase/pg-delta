---
"@supabase/postgrest-typegen": minor
---

Add `@supabase/postgrest-typegen/openapi` producer: `openApiToGeneratorMetadata(doc)` builds `GeneratorMetadata` from a PostgREST OpenAPI document's `x-postgrest-typegen-metadata` vendor extension, so types can be generated from a PostgREST URL alone (no database connection). Requires PostgREST's opt-in `openapi-metadata` config to emit the extension.
