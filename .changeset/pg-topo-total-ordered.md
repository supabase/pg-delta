---
"@supabase/pg-topo": patch
---

`analyzeAndSort` now returns every successfully parsed statement exactly once. Each input string is parsed atomically, while separate array entries remain independent. The result keeps its maximal acyclic prefix first, then emits residual cycle components and blocked descendants in deterministic condensation-DAG order. `CYCLE_DETECTED` diagnostics and `graph.cycleGroups` are unchanged.

Consumers that feed `ordered` into a defer-and-retry applier now receive every successfully parsed statement exactly once. For example, `@supabase/pg-delta` declarative apply now reports genuinely unbuildable cycles as stuck instead of falsely reporting success after dropping the cycle statements.
