---
"@supabase/pg-delta": patch
---

Fix two dropped pg_depend endpoint resolutions in extract that lost real
dependency edges (issue #333). A user-defined window function (`prokind 'w'`)
is now resolved as a `function` fact, so a view or rule that uses it is ordered
and rebuilt against it. A user-created rule on a plain table (or any rule other
than a view/matview `_RETURN`) now resolves to its own `rule` fact instead of
being dropped, so the rule is rebuilt before a function it references is
dropped. Previously either endpoint resolved to NULL and the edge was silently
skipped, causing `apply` to fail with "cannot drop function … because other
objects depend on it".
