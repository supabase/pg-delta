---
"@supabase/pg-delta": minor
---

Export `classifySqlFiles` / `classifySqlContent`, a pure helper that classifies a proposed declarative export against an existing tree (`created` / `updated` / `unchanged` / `removed` / `unmanaged`) without writing or deleting files. The Supabase CLI can compose this for `schema pull`; `pgdelta schema export` keeps staging, unmanaged-file refusal, and install.
