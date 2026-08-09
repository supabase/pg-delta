---
"@supabase/pg-delta": major
---

**`pg-delta` is now a clean-room rewrite.** The published `@supabase/pg-delta`
package no longer wraps the legacy per-object-type diff engine — it is the
ground-up rebuild previously developed as `@supabase/pg-delta-next`, promoted
into place. This is a hard breaking change: the CLI, the public API, and every
persisted artifact format are new. Nothing carries over from the legacy engine
for compatibility. The legacy engine's last release is `1.0.0-alpha.33`, which
remains installable from npm; its source is in git history.

**Why it's different.** PostgreSQL is the only elaborator: state is resolved by
a real Postgres instance (a live DB, or a shadow DB populated from your `.sql`
files) and read back out of the catalog into a normalized, content-addressed
fact base. Diffing is generic (no per-object-type change classes), ordering
needs no hand-written cycle-breakers, and every migration is **proved** before
you trust it — applied to a clone, re-extracted, and checked for both state
convergence and data preservation.

**New CLI surface** (`pgdelta`): `plan`, `apply`, `render`, `prove`, `diff`,
`drift`, `snapshot`, `schema export`, `schema apply`, `schema lint`. Redesigned
public API across the `.`, `./extract`, `./plan`, `./apply`, `./proof`,
`./frontends`, `./sql-order`, `./sql-format`, `./core`, `./policy`, and
`./integrations` subpaths.

Highlights folded into this release (previously tracked as individual
`pg-delta-next` changes):

- **Declarative schema export/apply** with `by-object` / `ordered` / `grouped`
  layouts, co-located shadow/seed, management scope (`database` | `cluster`), and
  an optional `@supabase/pg-topo`-backed statement-reordering assist plus a
  database-free `schema lint`. **Export is a source-of-truth artifact**: SQL is
  pretty-printed by default (`--no-format` opts out), validated constraints fold
  inline into `CREATE TABLE`, indexes co-locate with their owning relation, and
  mutually-referencing foreign keys round-trip — all under the
  `load(export(db)) ≡ db` fidelity gate.
- **Integration profiles** (`raw` | `supabase` | loadable custom profiles) with
  extension intent handlers (e.g. `pg_cron`, `pg_partman`) and assumed
  schemas/roles for platform-managed ambient dependencies. A profile can declare
  its own **baseline** — a `snapshot` subtracted from both sides so platform
  objects (base-image roles, extension-owned schemas) stay invisible with no
  per-command flag; its digest is stamped on plan/export artifacts and reconciled
  at apply/prove so `plan == prove == apply` holds (a swapped/edited/missing
  baseline fails loud). `diff` / `drift` / `snapshot` gained `--profile` for parity.
- **Privilege correctness**: ALTER DEFAULT PRIVILEGES routing/elision,
  owner-ACL and revoked-PUBLIC-default convergence, aggregate/FDW grant
  handling.
- **Object coverage & ordering**: generated columns, domains (incl. NOT VALID
  constraints), publications (PG14 `FOR TABLE`), security labels, extension
  membership, array-of-composite ordering, standalone unique indexes referenced
  by foreign keys.
- **Secret redaction**: FDW option secrets and required passwords, with
  redaction-mode carried into `apply`/`prove` and a guard against
  snapshot/plan redaction mismatch.
- **PostgreSQL 14–18** support.
