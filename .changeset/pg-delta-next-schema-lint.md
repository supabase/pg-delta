---
"@supabase/pg-delta-next": minor
---

Add `schema lint --dir <dir>`: a pure static check of a declarative SQL directory via `@supabase/pg-topo`, with no database involved (kept out of the apply path so apply stays Postgres-truth). It surfaces shadow-load cycles (rendered as `a → b → (back to a)` with source locations) and other pg-topo diagnostics for proactive authoring. Cycles, parse errors and duplicate producers are blocking (exit 1); other findings are advisory warnings (exit 0). `analyzeForShadow` now also returns the mapped `diagnostics` it builds on.
