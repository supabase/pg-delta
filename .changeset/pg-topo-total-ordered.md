---
"@supabase/pg-topo": patch
---

`analyzeAndSort` now returns a total order: statements trapped in a dependency cycle are appended to `ordered` (in the same deterministic tie-break order) instead of being silently dropped. `CYCLE_DETECTED` diagnostics and `graph.cycleGroups` are unchanged. Consumers that feed `ordered` into a defer-and-retry applier now receive every input statement exactly once.
