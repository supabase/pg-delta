---
"@supabase/pg-squash": minor
---

Add `squash()` with a machine-checked equivalence proof, repair loop, volatility mask, `pgsquash` CLI, and a PG 17 corpus.

Default emit is verbatim user SQL with per-source-file provenance comments and no injected `BEGIN`/`COMMIT`. Pass `wrapTransactions` / `--wrap-transactions` to wrap packed files.
