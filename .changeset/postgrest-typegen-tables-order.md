---
"@supabase/postgrest-typegen": minor
---

Add `sortGeneratorMetadata`, a generator-agnostic pass that deterministically orders every `GeneratorMetadata` collection by a stable, **semantic** key (schema + name + signature; oid only as a final tie-breaker). The Go/Python/Swift generators emit objects in metadata order, so their output was sensitive to however the producer ordered its rows — the SQL introspector returns rows in environment-dependent heap order. Sorting by semantic keys (rather than oid, which differs across equivalent databases created in a different order) makes codegen byte-stable for the same logical schema regardless of the producer or environment. Callers apply `sortGeneratorMetadata` after introspection and before generation; the generators document that they expect pre-sorted input. Generator content is unchanged — only ordering is now canonical.
