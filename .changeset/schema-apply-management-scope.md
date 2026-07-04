---
"@supabase/pg-delta-next": minor
---

feat(pg-delta-next): schema apply --scope database|cluster (default database); stop diffing ambient cluster roles

`schema apply` gains a `--scope` flag selecting what it manages:

- **`database`** (default): database-local schema only. Roles and memberships are
  treated as **ambient** (assumed to exist at apply time) and are projected out of
  both diff sides and the fingerprint re-extract. Previously, when the shadow and
  target lived on different clusters (the normal deployment: a local shadow, a
  remote target), each cluster's unrelated roles diffed — planning a spurious
  `CREATE ROLE` for a shadow-only role and, worse, a **destructive `DROP ROLE`**
  for a target-only role. In database scope neither happens: a `GRANT … TO <role>`
  resolves against the target's actual roles (passed as `assumedRoles`), and a
  grant to a role the target lacks fails loudly at plan time. Object ownership is
  not managed in this scope.
- **`cluster`**: manages roles, memberships, and ownership; requires an isolated
  shadow (`--isolated-shadow`), validated up front, since loading cluster-global
  role DDL onto a shared shadow cluster would mutate roles other databases use.

Note: `--isolated-shadow` now controls only *where the shadow lives*; managing
roles requires `--scope cluster`. A directory of role DDL that previously reloaded
under `--isolated-shadow` alone now also needs `--scope cluster`.
