---
"@supabase/pg-delta": patch
---

Shadow load uses export `loadOrder` (else caller/lex order) first, reconnects once on a stuck session, then `reorderOnFailure` file-kind / statement-kind with a warning so authors can fix the tree.
