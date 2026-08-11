---
"@supabase/pg-delta": patch
---

Speed up `plan()` on large catalogs. Six behavior-preserving changes to the
planner's hot loops — the compiled-glob cache in policy matching, a per-object
memo for stable-id encoding, an objtype index for the default-ACL elision's
`ALTER DEFAULT PRIVILEGES` gate, memoized tie keys in the topological sort,
skipping the rename discovery diff when `renames` is `"off"` (the default), and
building the managed view's projection in a single `buildFactBase` pass.

On a 21.9k-fact catalog: a tiny-delta plan drops from ~524ms to ~276ms and a
from-empty plan of the whole catalog from ~5.6s to ~450ms. The rendered plan SQL
is byte-identical and action counts are unchanged.
