---
"@supabase/pg-delta": patch
---

Fix the planner dependency cycle when a non-relocatable extension is replaced
(e.g. pg_net installed in different schemas on the two sides). The forced
dependent rebuild no longer promotes reference-only extension members into
standalone DROP/CREATE actions, and actions that consume an extension member
now order against exactly one side of the replace (teardown before the DROP,
build-up after the re-CREATE) instead of impossibly against both.
