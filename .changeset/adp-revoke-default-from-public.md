---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): represent revoked built-in default privileges (ALTER DEFAULT PRIVILEGES REVOKE … FROM PUBLIC)

`pg_default_acl` stores the resulting default ACL, so a revoked built-in default
(e.g. `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, or
`… REVOKE USAGE ON TYPES FROM PUBLIC`) appeared only as the *absence* of a grantee
entry. The extractor took the stored ACL verbatim and the renderer only emitted
`GRANT`, so such a revoke was invisible: applying/exporting onto a database with
the built-in defaults left PUBLIC's `EXECUTE`/`USAGE` in place and never converged
(the hardening was silently dropped).

Default privileges are now modeled as **deviations from the built-in default**
(derived from `acldefault()`, version-robust): a grantee at its built-in default
produces no fact; a revoked built-in default produces an empty marker carrying the
privileges it removed. The renderer emits `REVOKE` for the marker on create and
restores the default with a `GRANT` on drop, so `REVOKE … FROM PUBLIC` round-trips
in both directions.

Known limitation (rare, unchanged behavior): a *partial* reduction of a grantee
that has a built-in default (e.g. revoking one of the owner's default table
privileges) is still rendered as a `GRANT` of the remaining set; PUBLIC's
function/type defaults are single-privilege so PUBLIC is always exact, and owner
partial reductions are not used in practice.
