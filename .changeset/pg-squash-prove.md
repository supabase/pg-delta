---
"@supabase/pg-squash": minor
---

Add `squash()` with a machine-checked equivalence proof, repair loop, volatility mask, `pgsquash` CLI, and a PG 17 corpus.

Default emit is verbatim user SQL with per-source-file provenance comments and no injected `BEGIN`/`COMMIT`. Pass `wrapTransactions` / `--wrap-transactions` to wrap packed files.

The CLI publishes SQL only after `proof.equal`. Ledger revert drops replay databases first. Runtime 25001 isolates the failing source statement. Volatility masking keeps stable columns as row tuples instead of independent multisets. The ledger reads `pg_roles` so a CREATEDB admin can snapshot it.
