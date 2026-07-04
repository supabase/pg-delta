---
"@supabase/pg-delta-next": minor
---

feat(pg-delta-next): seed assumed-schema objects into the co-located shadow (quick mode)

`schema apply` in quick mode (no `--shadow`) creates a fresh throwaway shadow on
the target's own cluster. Under a profile that assumes platform schemas
(`--profile supabase`), that shadow now gets SEEDED with the target's
assumed-schema objects before the declarative files load, so a user object that
references a platform table — e.g. `CREATE TRIGGER … ON auth.users` — resolves
instead of failing the load with `relation "auth.users" does not exist`.

The seed is derived from the target's own managed view: the assumed-schema
reference-only facts (`auth.users`, `storage.*`) plus any system extension whose
install schema is assumed (materializing its members via `CREATE EXTENSION`).
Extension members themselves are NOT seeded — they can't be created standalone,
and they're reference-only on the target side so the diff skips them either way.
After the seed + user load, the shadow is re-extracted through the same profile,
so the seeded objects come back reference-only and cancel symmetrically in the
plan — nothing leaks into the diff.

Scope: co-located shadows only (they share the target's cluster, so platform
roles already exist for the seed's grants). Explicit `--shadow` keeps
bring-your-own-bootstrap; the `raw` profile has no assumed schemas so the seed is
inert. If the seed SQL fails to replay (a platform object depending on an
extension member/type the seed doesn't reproduce), apply stops with a message
pointing to `--shadow`. `schema apply` now also prints per-phase timing
(`seed · load · extract · plan`).
