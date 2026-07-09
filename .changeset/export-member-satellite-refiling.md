---
"@supabase/pg-delta": patch
---

`schema export` now files ACL/comment satellites whose target is an **extension member** into the owning extension's file (`cluster/extensions/<ext>.sql`, next to its `CREATE EXTENSION`) instead of scattering them across `schemas/<s>/<category>/…`. A database with pgTAP installed no longer sprouts hundreds of REVOKE-only function files — the state stays fully managed and round-trip-convergent; only its file placement changes. The grouped layout's flat-schema / name-pattern regrouping preserves the extension routing.
