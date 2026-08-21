---
"@supabase/pg-topo": patch
---

Preserve local built-in-looking range, operator, and operator-class support objects, recognize built-in range subtype-diff helpers plus pg_catalog opclass/operator callbacks, normalize PostgreSQL array, row-type array, and multirange array type references, and report missing default range subtype opclasses without false positives for external or pg_catalog polymorphic defaults.
