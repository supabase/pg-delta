---
"@supabase/pg-topo": minor
---

`analyzeAndSort` now returns a total order: statements trapped in a dependency cycle are appended to `ordered` (in the same deterministic tie-break order) instead of being silently dropped. `CYCLE_DETECTED` diagnostics and `graph.cycleGroups` are unchanged. Consumers that feed `ordered` into a defer-and-retry applier now receive every input statement exactly once.

This is a consumer-observable behavior change (hence minor, not patch): a defer-and-retry applier fed a genuinely unbreakable cycle now attempts the cycle members and fails loudly rather than silently applying a partial schema. For example, `@supabase/pg-delta`'s declarative apply now reports `stuck` for a mutual-foreign-key or mutual-view cycle instead of reporting success with the cycle statements missing.
