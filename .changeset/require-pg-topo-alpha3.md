---
"@supabase/pg-delta": patch
---

Require `@supabase/pg-topo@^1.0.0-alpha.3` (was `^1.0.0-alpha.2`). `schema apply`'s reorder assist now relies on pg-topo alpha.3's total-order behavior, where cycle members remain in the `ordered` output so pg-delta fails loudly instead of silently loading a partial schema (alpha.2's behavior). A consumer with only alpha.2 installed satisfied the old range but could hit the silent-omission path.
