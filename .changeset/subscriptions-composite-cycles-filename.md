---
"@supabase/pg-delta": patch
---

Fix five correctness issues in planning and extraction:

- **Subscription `two_phase` change no longer drops the subscription.** It was classified as a "replace", so a `two_phase` flip emitted `DROP SUBSCRIPTION` + `CREATE SUBSCRIPTION` — dropping the publisher's replication slot and silently breaking replication. On PostgreSQL 18+ (which added `ALTER SUBSCRIPTION … SET (two_phase)`) the change now goes through `DISABLE` → `SET (two_phase)` → optional `ENABLE` and preserves the slot; on PG < 18 it fails loudly at plan time instead of doing the destructive recreate.
- **Redacted subscriptions stay disabled.** A subscription rebuilt from a redacted extraction carries a placeholder connection string; the plan no longer emits the `ENABLE` follow-up (which would start a replication worker against a bogus host), and the redacted `CREATE` now carries a note telling the operator to set a real connection and enable it manually.
- **Composite-attribute type dependencies order before `DROP TYPE`.** When a composite type's attribute stops using a user type that the same plan drops, the `ALTER TYPE … ALTER ATTRIBUTE … TYPE` now releases the old type (and consumes the new one), so it is ordered before the `DROP TYPE` instead of after it.
- **`buildFactBase` rejects parent cycles.** A self-parent or parent cycle previously passed the missing-parent check yet reached no root, so the whole component was silently dropped from the fingerprint. Construction now throws, naming the cycle members.
- **`file_fdw`'s `filename` option is no longer redacted.** `filename` (and `program`, `null`, `force_not_null`, `force_null`) are non-secret and are now preserved verbatim, so a default-redacted export no longer creates foreign tables pointing at the literal `__OPTION_FILENAME__`.
