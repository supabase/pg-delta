---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): reject prove snapshot/plan redaction mismatch; correct unsafe-plan help text

- `prove` re-extracts the (mutated) clone with the plan's redaction mode and
  compares it to the desired snapshot. If the snapshot was captured with a
  different mode, FDW/subscription secrets compared placeholder-vs-real and the
  proof failed spuriously — only after the clone was already destroyed. `prove`
  now rejects a snapshot whose stamped `redactSecrets` differs from the plan's,
  with exit code 2, before opening the clone.
- The `--help` text no longer claims an unredacted plan "requires apply --force".
  Since the redaction mode is stamped on the artifact and `apply`/`prove`
  re-extract with it, the fingerprint gate passes without `--force`; the help now
  says so (and notes snapshots carry their mode for `drift`).
