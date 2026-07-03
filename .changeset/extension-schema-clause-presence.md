---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): decide the CREATE EXTENSION SCHEMA clause by plan-time schema presence

`CREATE EXTENSION` now emits `SCHEMA <s>` based on whether schema `s` will exist
when the statement runs — present on the target (resolved source view, including
reference-only platform schemas like Supabase's `extensions`) or produced by this
plan (a managed, non-reference-only desired schema, ordered before the extension)
— rather than on an extract-time signal. Otherwise it emits the bare form so an
extension that creates its own schema from its control file (e.g. `pgmq`) does
not reference a not-yet-existing schema.

This replaces the `_schemaIsMember` gate, which was derived from a `pg_depend`
`deptype='e'` schema→extension edge that Postgres never records (a `DROP
EXTENSION` leaves such schemas behind). That EXISTS check was always false, so
the rule always appended the clause and produced un-appliable DDL:

- `CREATE EXTENSION "pgmq" SCHEMA "pgmq"` failed with `schema "pgmq" does not
  exist` (pgmq creates its own schema; the bare form is required).
- `CREATE EXTENSION "pg_cron" SCHEMA "pg_catalog"` tripped the requirement guard
  (`pg_catalog` is a built-in, never extracted). The bare form fixes it with no
  guard change.

`pg_net`/`citext` installed into the pre-existing `extensions` schema keep their
`SCHEMA extensions` clause. The always-false `_schemaIsMember` extraction field
is removed (non-semantic, no fingerprint change). `FactView` gains
`isReferenceOnly`, and the create rule receives the source view (mirroring the
existing attribute-alter plumbing).
