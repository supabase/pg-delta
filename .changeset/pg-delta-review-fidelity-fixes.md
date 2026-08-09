---
"@supabase/pg-delta": patch
---

Four PR-review fidelity/correctness fixes:

- **Range type in-use replacement guard.** Changing a range type's attributes
  (`subtype`, `subtype_opclass`, …) is a drop+create. When a surviving table
  column still uses the type, PostgreSQL rejects the `DROP TYPE` at apply time;
  the planner now fails loud at plan time with an actionable message instead of
  emitting a plan that crashes on apply (mirrors the in-use composite
  `ALTER ATTRIBUTE` guard).
- **Rewrite-rule enabled state on create.** A freshly created rule always lands
  enabled; the create path now appends the follow-up
  `ALTER TABLE … {DISABLE | ENABLE REPLICA | ENABLE ALWAYS} RULE …` when the
  desired rule is not origin-enabled, so a disabled/replica/always rule
  converges (its `ev_enabled` is hashed).
- **Deterministic inheritance-parent extraction.** The single captured
  `parentTable` for a multiple-inheritance table now sorts the `pg_inherits`
  subquery by `inhseqno`, so the first-declared parent is captured
  deterministically and no longer flaps the fact hash across extractions.
- **Column-level grant extraction/render.** `pg_attribute.attacl`
  (`GRANT SELECT (col) ON t TO r`) is now extracted and rendered as
  column-qualified GRANT/REVOKE actions, so a from-empty export no longer
  silently drops column privileges and schemas differing only by column grants
  no longer hash equal.
