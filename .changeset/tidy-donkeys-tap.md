---
"@supabase/pg-delta": patch
---

Plan ordering: actions that evaluate user expressions at apply time (column defaults, generated columns, CHECK validation, expression indexes) are now scheduled after all ready definition actions, so opaque quoted routine bodies can resolve their helpers.
