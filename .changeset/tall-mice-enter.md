---
"@supabase/pg-delta": patch
---

Prevent proof and shadow endpoint mixups by matching `pg`'s effective connection-string semantics, rejecting ambiguous duplicate endpoint parameters, and validating every trusted host. Preflight proof inputs before warning about possible clone mutation, document optional co-located shadows, and require explicit approval for data-destructive apply actions. Strictly validate plan action metadata, reject contradictory destruction declarations for intrinsically data-bearing objects in library apply/proof before mutation, classify cascading child destruction through its owning relation or type, follow accepted ancestor renames when proving descendant table data, fail proof when an undeclared persisted relation vanishes, and include implicitly destroyed extension members in `DROP EXTENSION` action metadata.
