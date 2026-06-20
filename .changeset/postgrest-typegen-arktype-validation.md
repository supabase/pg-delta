---
"@supabase/postgrest-typegen": minor
---

Back `GeneratorMetadata` with an ArkType schema as the single source of truth (each `Postgres*` type is now derived via `.infer`), and add an opt-in `parseGeneratorMetadata(data)` runtime validator plus the exported `generatorMetadataSchema`. This lets integrators producing `GeneratorMetadata` through a custom/injected introspection adapter validate the result at runtime instead of blindly casting. Validation is intentionally not baked into `introspect()`. The inferred types remain structurally identical to the previous interfaces (pinned by a compile-time equivalence test), so generator output is unchanged.
