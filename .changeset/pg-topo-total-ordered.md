---
"@supabase/pg-topo": patch
---

`analyzeAndSort` now returns a total order of every successfully parsed statement: statements trapped in a dependency cycle are emitted in deterministic component order instead of being silently dropped. `CYCLE_DETECTED` diagnostics and `graph.cycleGroups` are unchanged.

Consumers that feed `ordered` into a defer-and-retry applier now receive every successfully parsed statement exactly once. For example, `@supabase/pg-delta` declarative apply now reports genuinely unbuildable cycles as stuck instead of falsely reporting success after dropping the cycle statements.
