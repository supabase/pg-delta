---
"@supabase/pg-delta": minor
---

Export `Segment`, `segmentActions`, and `planSegments` from the package root and `@supabase/pg-delta/frontends` so library consumers can group a plan into apply transaction segments without importing `src/apply/apply.ts`.
