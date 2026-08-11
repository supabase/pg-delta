---
"@supabase/pg-delta": patch
---

Speed up `plan()` on large catalogs. Six behavior-preserving changes to the
planner's hot loops — the compiled-glob cache in policy matching, a per-object
memo for stable-id encoding, an objtype index for the default-ACL elision's
`ALTER DEFAULT PRIVILEGES` gate, memoized tie keys in the topological sort,
skipping the rename discovery diff when `renames` is `"off"` (the default), and
building the managed view's projection in a single `buildFactBase` pass.

Measured on a 21.9k-fact catalog (p50 of 10 timed reps, back-to-back on one
machine): a tiny-delta plan drops from ~604ms to ~294ms under the Supabase
profile and from ~248ms to ~183ms under the raw profile, and a from-empty plan of
the whole catalog from ~2.46s to ~486ms. The rendered plan SQL is byte-identical
(sha256) and action counts are unchanged in every cell.
