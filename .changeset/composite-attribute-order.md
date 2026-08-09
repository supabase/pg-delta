---
"@supabase/pg-delta": patch
---

Preserve composite type attribute order. The composite `CREATE TYPE … AS (…)` rule assembled attributes in encoded-id (name) order, silently reordering columns (e.g. `errors` before `wal`) on every reconstruction — a row-layout change that broke composite-returning dependents at body validation. The extractor now carries the declared attribute position (as the non-semantic `_position` payload key, excluded from hash/diff), and the composite create renders attributes in that order.
