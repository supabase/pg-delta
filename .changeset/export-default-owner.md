---
"@supabase/pg-delta": minor
---

`schema export` now serializes object ownership as `ALTER … OWNER TO` (an assumed
role reference, consistent with how ACLs already round-trip) instead of dropping
it at the default `--scope database`. Ownership is suppressed only for the
resolved DEFAULT owner so exports stay human-readable: the default resolves
`--default-owner <role|none>` (new flag) > the profile-declared default (Supabase
→ `postgres`) > the database owner (`datdba`). `--default-owner none` emits every
`OWNER TO` for maximum fidelity.

Previously, database-scope exports dropped all ownership, so objects owned by a
non-applier role (e.g. Supabase's `auth_admin`) reloaded applier-owned and then
showed up as spurious `ALTER … OWNER TO` / `REVOKE … FROM postgres` drift. This
now holds even when the database has extensions or assumed schemas present: the
managed view is rebuilt to attach reference-only marks in that case, and the
rebuild no longer silently re-prunes the retained owner references (which had made
a real Supabase export emit zero `OWNER TO`).

The export manifest stamps the resolved default owner (a role name, or `null` for
a verbose export; a field-absent directory is treated as pre-feature). `schema
apply` reconstructs the identical view and fails closed (exit 2) when the target
connection role differs from a role-name default. Policy-based owner exclusion is
unchanged.
