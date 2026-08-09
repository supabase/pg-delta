---
"@supabase/pg-delta": patch
---

Make the co-located shadow seed (`schema apply --profile supabase` without `--shadow`) replayable by non-superuser roles. Real Supabase Cloud gives users a privileged NON-superuser `postgres`, so the assumed-schema seed previously failed at the seed step. The seed now omits (never rewrites) the two fact classes a non-superuser cannot replay: a routine whose `proconfig` SETs a superuser-only GUC (detected from structured catalog data, context-driven — e.g. `SET log_min_messages`, never `search_path`) is skipped whole along with anything depending on it (transitively, including the contained children — e.g. columns — of any excluded container object), and platform default-privilege entries (`ALTER DEFAULT PRIVILEGES FOR ROLE …`) are omitted. Both are inert to omit: a seeded object re-extracts reference-only and cancels in the diff, so its absence is symmetric, and a default-privilege entry has no possible dependents.
