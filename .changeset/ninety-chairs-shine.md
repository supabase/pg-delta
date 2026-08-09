---
"@supabase/pg-delta": minor
---

Normalize accepted role renames before diffing so OID-carried references do not produce spurious policy, ownership, grant, membership, or user-mapping churn. Reconcile ordinary rename emission with the canonical policy filter so the action list and projected target cannot diverge.
