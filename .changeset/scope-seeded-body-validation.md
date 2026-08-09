---
"@supabase/pg-delta": patch
---

Scope shadow body validation to non-seeded schemas: under `--profile supabase`, a broken routine in a pre-seeded platform schema (auth/storage/realtime/...) now surfaces as a warning instead of aborting the load, since seeded objects are reference-only on both sides of the diff. Body-validation diagnostics now name the failing routine (`schema.name: ...`), and the CLI's top-level error handler prints per-item error details instead of only the summary message.
