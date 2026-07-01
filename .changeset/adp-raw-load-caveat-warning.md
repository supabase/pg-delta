---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): warn that raw loading may apply ALTER DEFAULT PRIVILEGES after same-load objects

When `schema apply` falls back to the raw file-granular loader because a directory
contains `ALTER DEFAULT PRIVILEGES` (the reorder assist is disabled to avoid moving
an ADP past the objects it scopes), the loader's defer-and-retry can still apply an
ADP *after* objects created in the same load — so an object relying on ADP-implicit
default grants may not receive them. This is now surfaced as an explicit NOTE
alongside the existing "reorder assist disabled" warning, recommending explicit
grants. pg-delta's own `schema export` is unaffected: it writes every object's ACL
explicitly, so a generated export round-trips regardless of ADP order; the caveat
concerns hand-authored declarative files that rely on ADP-implicit grants.
