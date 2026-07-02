---
"@supabase/pg-delta-next": minor
---

feat(pg-delta-next): scope-aware export + cluster-DDL guard for schema apply --scope database

Completes the `--scope` feature (see the management-scope changeset):

- `schema export` gains `--scope database|cluster` (default `database`). Database
  scope projects out cluster-global roles/memberships, so no `cluster/roles.sql`
  is written and the directory reloads on any cluster. The scope is stamped in
  `.pgdelta-export.json`, and `schema apply` defaults to it and rejects a
  contradicting `--scope` (like the profile/redaction reconciliation).
- `schema apply --scope database` now refuses cluster-global DDL found in the
  input files (`CREATE/ALTER/DROP ROLE`, role membership `GRANT/REVOKE`,
  `COMMENT/SECURITY LABEL ON ROLE`) up front with a clear, scope-framed error and
  the escapes — instead of letting the shadow load trip the lower-level
  shared-object leak guard. `--skip-cluster-ddl` drops those statements and loads
  the rest, logging each skipped statement (never a silent miss). Membership
  grants are distinguished from privilege grants by the absence of an `ON` target.
