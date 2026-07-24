---
"@supabase/pg-delta": patch
---

Prevent proof and shadow endpoint mixups by matching `pg`'s effective connection-string semantics, rejecting ambiguous duplicate endpoint parameters, and validating every trusted host. Preflight proof inputs before warning about possible clone mutation, document optional co-located shadows, and require explicit approval for data-destructive apply actions.
