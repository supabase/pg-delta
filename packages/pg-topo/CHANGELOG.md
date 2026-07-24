# @supabase/pg-topo

## 1.0.0-alpha.4

### Patch Changes

- ff57cfc: `analyzeAndSort` now returns every successfully parsed statement exactly once. Each input string is parsed atomically, while separate array entries remain independent. The result keeps its maximal acyclic prefix first, then emits residual cycle components and blocked descendants in deterministic condensation-DAG order. `CYCLE_DETECTED` diagnostics and `graph.cycleGroups` are unchanged.

  Consumers that feed `ordered` into a defer-and-retry applier now receive every successfully parsed statement exactly once. For example, `@supabase/pg-delta` declarative apply now reports genuinely unbuildable cycles as stuck instead of falsely reporting success after dropping the cycle statements.

## 1.0.0-alpha.3

### Patch Changes

- c06f081: Support classifying and ordering ALTER PUBLICATION and ALTER SUBSCRIPTION statements.

## 1.0.0-alpha.2

### Patch Changes

- a5a69fc: Track function dependencies in ALTER TABLE expression subcommands.
- cf0df37: Resolve `COMMENT ON RULE` dependencies so comments are ordered after the rule they target. `objectKindFromObjType` now maps `OBJECT_RULE`, and rule comment refs use the same `relation.objectName` identity as triggers and policies. Plain views now also provide their implicit `_RETURN` rewrite rule, so `COMMENT ON RULE "_RETURN" ON <view>` resolves to the view instead of reporting an unresolved dependency.
- 436b3d1: Support ordering CREATE RULE statements with predicate and action dependencies.

## 1.0.0-alpha.1

### Minor Changes

- 2441e1c: feat: add declarative export/apply and catalog-export to pg-delta

## 1.0.0-alpha.0

### Major Changes

- 0cefa0a: alpha release @supabase/pg-topo
