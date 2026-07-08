---
"@supabase/pg-delta": patch
---

`schema apply` shadow-load failures now name the offending statement. When a load gets stuck or exhausts its retry rounds, each per-file diagnostic includes the failing line and a short excerpt (derived from PostgreSQL's error position), and notes when a file has failed identically across multiple rounds ("likely a genuine missing dependency, not ordering") — so a non-converging declarative directory is diagnosable without bisecting files by hand.
