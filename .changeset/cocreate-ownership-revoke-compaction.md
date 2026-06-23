---
"@supabase/pg-delta-next": patch
---

Add two cosmetic, proof-stable compaction passes for co-created objects:

- **co-create ownership fold** — a freshly-created object's owner `ALTER` folds
  into its `CREATE`. Schemas collapse to `CREATE SCHEMA … AUTHORIZATION owner`
  (always, a syntactic equivalence), and a no-op `ALTER … OWNER TO` is elided on
  any ownable kind when the desired owner is the applier (`capability.role`).
- **co-create REVOKE elision** — the cosmetic leading `REVOKE ALL` is trimmed off
  a remaining third-party grant on a co-created object while every `GRANT` is
  kept, guarded by a strict-superset check against any create-time
  `defaultPrivilege` for the applier role so a load-bearing `REVOKE` is never
  dropped.

Both run only with `--compact` (the default), are detected structurally (no SQL
parsing), and converge to the identical state with compaction on or off.
